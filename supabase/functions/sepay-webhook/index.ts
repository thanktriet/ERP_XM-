// ============================================================
// Edge Function: sepay-webhook
// Xử lý webhook POST từ SEPay khi có tiền chuyển khoản về
//
// Schema thực tế:
//   - acc_vouchers        (thay thế receipts)
//   - acc_sync_queue      (thay thế amis_sync_queue)
//   - acc_ar_ledger       (cập nhật matched_amount sau khi thu)
//   - notifications       (thông báo realtime)
//   - sales_orders        (order_number — không phải order_code)
//   - acc_organizations   (org cố định: 00000000-0000-0000-0000-000000000001)
//
// Luồng:
//   POST → verify HMAC → idempotency check (acc_vouchers.description chứa referenceCode)
//   → fuzzy match order_number → tạo acc_voucher type=receipt → auto-post
//   → trigger trg_enqueue_amis_sync tự đẩy acc_sync_queue (không cần insert thủ công)
//   → upsert acc_ar_ledger (receipt entry) → gọi upsert_acc_notification()
//   → trả 200
// ============================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createClient,
  SupabaseClient,
} from 'https://esm.sh/@supabase/supabase-js@2';

// ---- Constants ----
const ORG_ID    = '00000000-0000-0000-0000-000000000001';
const BRANCH_ID = '00000000-0000-0000-0000-000000000010'; // MAIN-001; sẽ override từ order nếu có

// ---- Types ----
interface SePayPayload {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount: string | null;
  code: string | null;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  accumulated: number;
  referenceCode: string;
  description: string;
}

type MatchCase = 'matched_full' | 'matched_partial' | 'matched_excess' | 'not_matched';

interface OrderInfo {
  id: string;
  order_number: string;      // ⚠️ thực tế là order_number, không phải order_code
  total_amount: number;
  already_paid: number;
  customer_id: string;
  branch_id: string | null;
  status: string;
  fiscal_period_id: string;  // cần để tạo acc_voucher
}

// ============================================================
// HMAC SHA256 Verification (constant-time)
// ============================================================
async function verifyHmacSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

// ============================================================
// Fuzzy Match: tìm order_number trong nội dung chuyển khoản
// ============================================================
function normalizeText(text: string): string {
  return text.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractOrderNumbers(content: string): string[] {
  const normalized = normalizeText(content);
  // Match DH + 7-10 chữ số (DH2026001, DH20260001, ...)
  const patterns = [/DH\d{7,10}/g, /DH\s+\d{7,10}/g];
  const codes: string[] = [];
  for (const p of patterns) {
    for (const m of normalized.matchAll(p)) {
      codes.push(m[0].replace(/\s+/g, ''));
    }
  }
  return [...new Set(codes)];
}

// ============================================================
// Lookup order từ DB
// ============================================================
async function findOrderByNumber(db: SupabaseClient, orderNumbers: string[]): Promise<OrderInfo | null> {
  if (orderNumbers.length === 0) return null;

  // Lấy order
  const { data: order, error } = await db
    .from('sales_orders')
    .select('id, order_number, total_amount, customer_id, branch_id, status')
    .in('order_number', orderNumbers)
    .not('status', 'in', '("cancelled")')
    .limit(1)
    .maybeSingle();

  if (error || !order) return null;

  // Lấy fiscal_period_id phù hợp với ngày hôm nay
  const today = new Date().toISOString().split('T')[0];
  const { data: period } = await db
    .from('acc_fiscal_periods')
    .select('id')
    .lte('start_date', today)
    .gte('end_date', today)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle();

  if (!period) {
    console.error('[sepay-webhook] Không tìm được kỳ kế toán mở cho ngày', today);
    return null;
  }

  // Tính số tiền đã thu: acc_vouchers type=receipt, reference_id=order.id, status=posted
  const { data: paidVouchers } = await db
    .from('acc_vouchers')
    .select('total_debit')
    .eq('reference_type', 'sales_order')
    .eq('reference_id', order.id)
    .eq('voucher_type', 'receipt')
    .eq('status', 'posted');

  const already_paid = (paidVouchers ?? []).reduce(
    (s: number, v: { total_debit: number }) => s + v.total_debit, 0
  );

  return {
    id:               order.id,
    order_number:     order.order_number,
    total_amount:     order.total_amount,
    already_paid,
    customer_id:      order.customer_id,
    branch_id:        order.branch_id ?? BRANCH_ID,
    status:           order.status,
    fiscal_period_id: period.id,
  };
}

// ============================================================
// Xác định loại match
// ============================================================
function determineMatchCase(transferAmount: number, order: OrderInfo): MatchCase {
  const remaining = order.total_amount - order.already_paid;
  const tolerance = 1_000; // ±1,000 VND sai số chấp nhận
  if (Math.abs(transferAmount - remaining) <= tolerance) return 'matched_full';
  if (transferAmount < remaining - tolerance) return 'matched_partial';
  return 'matched_excess';
}

// ============================================================
// Sinh số chứng từ PT (đơn giản: PT + ngày + random)
// Trigger DB sẽ generate voucher_number, nhưng nếu cần pre-fill
// ============================================================
function buildVoucherNumber(type: 'PT' | 'PC'): string {
  const d = new Date();
  const yyyymmdd = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `${type}${yyyymmdd}${seq}`;
}

// ============================================================
// Tạo acc_voucher (phiếu thu) + auto-post
// acc_sync_queue được tự fill bởi trigger trg_enqueue_amis_sync
// ============================================================
async function createReceiptVoucher(
  db: SupabaseClient,
  order: OrderInfo,
  transferAmount: number,
  referenceCode: string,
  content: string,
  matchCase: MatchCase
): Promise<{ id: string; voucher_number: string } | null> {
  const today = new Date().toISOString().split('T')[0];

  // Xác định tài khoản định khoản (chuyển khoản ngân hàng)
  // Nợ 112 / Có 131
  const debitAccCode  = '112';  // Tiền gửi ngân hàng
  const creditAccCode = '131';  // Phải thu khách hàng

  // Lấy account_id từ acc_accounts
  const { data: accounts } = await db
    .from('acc_accounts')
    .select('id, account_code')
    .in('account_code', [debitAccCode, creditAccCode])
    .eq('is_active', true);

  const debitAcc  = accounts?.find((a: { account_code: string }) => a.account_code === debitAccCode);
  const creditAcc = accounts?.find((a: { account_code: string }) => a.account_code === creditAccCode);

  if (!debitAcc || !creditAcc) {
    console.error('[sepay-webhook] Không tìm thấy tài khoản', debitAccCode, creditAccCode);
    return null;
  }

  // Tạo acc_voucher với status=posted để trigger tự enqueue AMIS sync
  const { data: voucher, error } = await db
    .from('acc_vouchers')
    .insert({
      org_id:           ORG_ID,
      branch_id:        order.branch_id ?? BRANCH_ID,
      voucher_number:   buildVoucherNumber('PT'),
      voucher_type:     'receipt',
      voucher_date:     today,
      fiscal_period_id: order.fiscal_period_id,
      description:      `Thu tiền đơn hàng ${order.order_number} | ${referenceCode} | ${content.slice(0, 100)}`,
      reference_type:   'sales_order',
      reference_id:     order.id,
      customer_id:      order.customer_id,
      status:           'posted',                    // auto-post → trigger enqueue AMIS
      total_debit:      transferAmount,
      total_credit:     transferAmount,
      amis_sync_status: 'pending',
    })
    .select('id, voucher_number')
    .single();

  if (error) {
    console.error('[sepay-webhook] Lỗi tạo acc_voucher:', error);
    return null;
  }

  // Tạo journal entry lines (Nợ 112 / Có 131)
  await db.from('acc_journal_entry_lines').insert([
    {
      voucher_id:   voucher.id,
      account_id:   debitAcc.id,
      account_code: debitAccCode,
      debit_amount: transferAmount,
      credit_amount: 0,
      description:  `Thu tiền bán xe ${order.order_number}`,
      customer_id:  order.customer_id,
    },
    {
      voucher_id:    voucher.id,
      account_id:    creditAcc.id,
      account_code:  creditAccCode,
      debit_amount:  0,
      credit_amount: transferAmount,
      description:   `Giảm công nợ KH - đơn ${order.order_number}`,
      customer_id:   order.customer_id,
    },
  ]);

  // Cập nhật acc_ar_ledger (receipt entry — giảm phải thu)
  await db.from('acc_ar_ledger').insert({
    org_id:          ORG_ID,
    branch_id:       order.branch_id ?? BRANCH_ID,
    customer_id:     order.customer_id,
    voucher_id:      voucher.id,
    voucher_date:    today,
    entry_type:      'receipt',
    debit_amount:    0,
    credit_amount:   transferAmount,
    matched_amount:  transferAmount,
    reference_number: referenceCode,
    description:     `Thu tiền đơn hàng ${order.order_number}`,
  });

  // Thông báo vào notifications
  await db.rpc('upsert_acc_notification', {
    p_type:          'payment_received',
    p_title:         `Nhận thanh toán đơn ${order.order_number}`,
    p_message:       `${matchCase === 'matched_full' ? '✅ Đã thu đủ' : '⚠️ Thu một phần'}: ${transferAmount.toLocaleString('vi-VN')} VND qua chuyển khoản. Ref: ${referenceCode}`,
    p_severity:      matchCase === 'matched_full' ? 'success' : 'warning',
    p_branch_id:     order.branch_id ?? BRANCH_ID,
    p_target_roles:  ['admin', 'accountant', 'manager', 'sales'],
    p_link_path:     `/payment/${order.id}`,
    p_reference_type: 'acc_voucher',
    p_reference_id:  voucher.id,
    p_expires_hours: 72,
  });

  return voucher;
}

// ============================================================
// Handler chính
// ============================================================
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.text();

  // ---- Verify HMAC ----
  const signature    = req.headers.get('x-sepay-signature') ?? '';
  const webhookSecret = Deno.env.get('SEPAY_WEBHOOK_SECRET') ?? '';

  if (webhookSecret && signature) {
    const isValid = await verifyHmacSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      console.error('[sepay-webhook] Chữ ký không hợp lệ');
      return new Response(JSON.stringify({ success: false, error: 'Chữ ký không hợp lệ' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  let payload: SePayPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Payload không hợp lệ' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Chỉ xử lý chuyển khoản vào
  if (payload.transferType !== 'in') {
    return new Response(JSON.stringify({ success: true, skipped: 'out_transfer' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  // ---- IDEMPOTENCY: kiểm tra referenceCode trong description của acc_vouchers ----
  // SEPay gửi referenceCode vào description, ta lưu ở field description
  const { data: existingVoucher } = await db
    .from('acc_vouchers')
    .select('id, voucher_number')
    .eq('voucher_type', 'receipt')
    .like('description', `%${payload.referenceCode}%`)
    .limit(1)
    .maybeSingle();

  if (existingVoucher) {
    console.log(`[sepay-webhook] Idempotent: referenceCode ${payload.referenceCode} đã có voucher ${existingVoucher.voucher_number}`);
    return new Response(
      JSON.stringify({ success: true, idempotent: true, voucher_id: existingVoucher.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ---- Fuzzy match order_number ----
  const candidateCodes = payload.code
    ? [payload.code]
    : extractOrderNumbers(payload.content);

  const order = await findOrderByNumber(db, candidateCodes);

  if (!order) {
    // Lưu vào notifications để kế toán xử lý thủ công
    await db.rpc('upsert_acc_notification', {
      p_type:         'payment_unmatched',
      p_title:        'Chuyển khoản không khớp đơn hàng',
      p_message:      `Nhận ${payload.transferAmount.toLocaleString('vi-VN')} VND từ ${payload.accountNumber}. Ref: ${payload.referenceCode}. Nội dung: "${payload.content}"`,
      p_severity:     'warning',
      p_target_roles: ['admin', 'accountant'],
      p_expires_hours: 168,  // 7 ngày
    });

    console.warn(`[sepay-webhook] Không khớp đơn — ref: ${payload.referenceCode}, amount: ${payload.transferAmount}`);
    return new Response(
      JSON.stringify({ success: true, case: 'not_matched', reference_code: payload.referenceCode }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const matchCase = determineMatchCase(payload.transferAmount, order);
  console.log(`[sepay-webhook] Match: ${matchCase}, order: ${order.order_number}, ref: ${payload.referenceCode}`);

  // ============================================================
  // Tạo acc_voucher (áp dụng cho tất cả match cases)
  // ============================================================
  const voucher = await createReceiptVoucher(
    db, order, payload.transferAmount, payload.referenceCode, payload.content, matchCase
  );

  if (!voucher) {
    return new Response(
      JSON.stringify({ success: false, error: 'Lỗi tạo chứng từ kế toán' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ============================================================
  // Cập nhật trạng thái đơn hàng theo match case
  // ============================================================
  const now = new Date().toISOString();

  if (matchCase === 'matched_full') {
    await db.from('sales_orders')
      .update({ status: 'full_paid', updated_at: now })
      .eq('id', order.id);

    return new Response(
      JSON.stringify({ success: true, case: 'matched_full', voucher_id: voucher.id, order_id: order.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (matchCase === 'matched_partial') {
    const remaining = order.total_amount - order.already_paid - payload.transferAmount;
    // Chỉ cập nhật nếu đơn chưa ở trạng thái cao hơn
    await db.from('sales_orders')
      .update({ status: 'deposit_paid', updated_at: now })
      .eq('id', order.id)
      .in('status', ['draft', 'confirmed']);

    return new Response(
      JSON.stringify({ success: true, case: 'matched_partial', voucher_id: voucher.id, order_id: order.id, remaining }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // matched_excess
  const excess = payload.transferAmount - (order.total_amount - order.already_paid);
  await db.from('sales_orders')
    .update({ status: 'full_paid', updated_at: now })
    .eq('id', order.id);

  return new Response(
    JSON.stringify({ success: true, case: 'matched_excess', voucher_id: voucher.id, order_id: order.id, excess }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
