// ============================================================
// Edge Function: amis-sync
// Chạy lúc 23:00 qua pg_cron — đẩy toàn bộ phiếu thu/chi pending lên AMIS
// ============================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createClient,
} from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Config ----
const AMIS_API_BASE = Deno.env.get('AMIS_API_BASE_URL') ?? 'https://actapp.misa.vn/api/v1';
const AMIS_ACCESS_TOKEN = Deno.env.get('AMIS_ACCESS_TOKEN') ?? '';
const MAX_RETRY = 3;
const BATCH_SIZE = 50;

// ---- AMIS API helper: tạo phiếu kế toán ----
interface AmisVoucherPayload {
  VoucherType: string;
  VoucherCode: string;
  VoucherDate: string;
  RefNo: string;
  Description: string;
  CurrencyCode: string;
  ExchangeRate: number;
  Amount: number;
  Details: {
    AccountCode: string;
    DebitAmount: number;
    CreditAmount: number;
    Description: string;
  }[];
}

interface AmisSyncResult {
  queue_id: string;
  success: boolean;
  amis_reference_id?: string;
  error?: string;
}

async function pushToAmis(
  payload: AmisVoucherPayload
): Promise<{ success: boolean; reference_id?: string; error?: string }> {
  try {
    const resp = await fetch(`${AMIS_API_BASE}/vouchers`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${AMIS_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000), // 10 giây timeout
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      return {
        success: false,
        error: `AMIS trả về ${resp.status}: ${errorText.slice(0, 200)}`,
      };
    }

    const data = await resp.json();
    return {
      success: true,
      reference_id: data?.VoucherID ?? data?.id ?? String(Date.now()),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Lỗi không xác định',
    };
  }
}

// ---- Retry với exponential backoff ----
async function pushWithRetry(
  payload: AmisVoucherPayload
): Promise<{ success: boolean; reference_id?: string; error?: string }> {
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    const result = await pushToAmis(payload);
    if (result.success) return result;

    lastError = result.error ?? 'Lỗi không xác định';
    console.warn(`[amis-sync] Attempt ${attempt}/${MAX_RETRY} thất bại: ${lastError}`);

    if (attempt < MAX_RETRY) {
      // Backoff: 2s, 4s, 8s
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  return { success: false, error: lastError };
}

// ---- Main ----
serve(async (req: Request) => {
  // Chấp nhận cả POST (từ pg_cron qua http_post) và GET (gọi tay debug)
  if (!['POST', 'GET'].includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  const startTime = Date.now();
  const results: AmisSyncResult[] = [];
  let processedCount = 0;
  let successCount = 0;
  let failCount = 0;

  console.log('[amis-sync] Bắt đầu đồng bộ AMIS...');

  // ---- Lấy batch pending/failed ----
  const { data: queueItems, error: fetchError } = await supabase
    .from('amis_sync_queue')
    .select('*')
    .in('amis_sync_status', ['pending', 'failed'])
    .lt('retry_count', MAX_RETRY)
    .order('transaction_date', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    console.error('[amis-sync] Lỗi lấy queue:', fetchError);
    return new Response(
      JSON.stringify({ success: false, error: fetchError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!queueItems || queueItems.length === 0) {
    console.log('[amis-sync] Không có giao dịch pending nào.');
    return new Response(
      JSON.stringify({ success: true, processed: 0, message: 'Không có giao dịch cần sync' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  console.log(`[amis-sync] Tìm thấy ${queueItems.length} giao dịch cần sync`);

  // ---- Xử lý từng item (tuần tự để tránh rate limit AMIS) ----
  for (const item of queueItems) {
    processedCount++;

    // Đánh dấu đang xử lý
    await supabase
      .from('amis_sync_queue')
      .update({ amis_sync_status: 'syncing' })
      .eq('id', item.id);

    const result = await pushWithRetry(item.payload as AmisVoucherPayload);

    if (result.success) {
      successCount++;
      await supabase
        .from('amis_sync_queue')
        .update({
          amis_sync_status: 'synced',
          amis_reference_id: result.reference_id,
          synced_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', item.id);

      // Cập nhật trạng thái sync trong bảng nguồn
      await supabase
        .from(item.source_type === 'receipt' ? 'receipts' : 'payments')
        .update({ amis_sync_status: 'synced' })
        .eq('id', item.source_id);

      results.push({ queue_id: item.id, success: true, amis_reference_id: result.reference_id });
    } else {
      failCount++;
      await supabase
        .from('amis_sync_queue')
        .update({
          amis_sync_status: 'failed',
          retry_count: (item.retry_count ?? 0) + 1,
          last_error: result.error,
        })
        .eq('id', item.id);

      if ((item.retry_count ?? 0) + 1 >= MAX_RETRY) {
        await supabase
          .from(item.source_type === 'receipt' ? 'receipts' : 'payments')
          .update({ amis_sync_status: 'failed' })
          .eq('id', item.source_id);
      }

      results.push({ queue_id: item.id, success: false, error: result.error });
    }
  }

  const duration = Date.now() - startTime;
  const summary = {
    run_at: new Date().toISOString(),
    processed: processedCount,
    success: successCount,
    failed: failCount,
    duration_ms: duration,
  };

  console.log('[amis-sync] Hoàn thành:', summary);

  // ---- Gửi báo cáo tóm tắt cho kế toán (qua Supabase Realtime / email) ----
  await sendSyncReport(supabase, summary, results);

  return new Response(
    JSON.stringify({ success: true, summary, results }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});

// ---- Gửi báo cáo: lưu vào bảng notifications + optional email ----
async function sendSyncReport(
  supabase: ReturnType<typeof createClient>,
  summary: {
    run_at: string;
    processed: number;
    success: number;
    failed: number;
    duration_ms: number;
  },
  results: AmisSyncResult[]
) {
  const failedItems = results.filter((r) => !r.success);
  const message =
    `[AMIS Sync ${new Date(summary.run_at).toLocaleDateString('vi-VN')}] ` +
    `Đã sync: ${summary.success}/${summary.processed} phiếu. ` +
    (summary.failed > 0
      ? `❌ Thất bại: ${summary.failed} phiếu — cần kiểm tra.`
      : '✅ Tất cả thành công.');

  // Lưu notification vào DB để hiển thị trên dashboard
  await supabase.from('notifications').insert({
    type: 'amis_sync_report',
    title: 'Báo cáo đồng bộ AMIS',
    message,
    payload: { summary, failed_items: failedItems },
    target_role: 'ke_toan_ho',
    is_read: false,
  }).then(({ error }) => {
    if (error) console.warn('[amis-sync] Không thể lưu notification:', error.message);
  });
}
