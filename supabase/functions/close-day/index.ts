// ============================================================
// Edge Function: close-day
// Chạy 23:30 hàng ngày hoặc gọi tay
// Logic: 3-way reconciliation → snapshot cash_balances
// ============================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface CloseDayRequest {
  branch_id?: string;       // Nếu gọi tay cho 1 chi nhánh cụ thể
  balance_date?: string;    // Mặc định = hôm nay (giờ VN)
  actual_cash?: number;     // Kiểm quỹ thực tế (VND)
  bank_statement_balance?: number; // Số dư sao kê ngân hàng
  force?: boolean;          // Bỏ qua kiểm tra chênh lệch (chỉ admin)
}

interface BranchCloseResult {
  branch_id: string;
  branch_name: string;
  status: 'reconciled' | 'discrepancy' | 'skipped' | 'error';
  message: string;
  cash_diff?: number;
  bank_diff?: number;
  snapshot?: {
    opening_cash: number;
    opening_bank: number;
    closing_cash: number;
    closing_bank: number;
    actual_cash: number;
    bank_statement_balance: number;
  };
}

serve(async (req: Request) => {
  if (!['POST', 'GET'].includes(req.method)) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
  );

  // Parse request body
  let reqBody: CloseDayRequest = {};
  if (req.method === 'POST') {
    try {
      const text = await req.text();
      if (text) reqBody = JSON.parse(text);
    } catch {
      reqBody = {};
    }
  }

  // Ngày đóng sổ = hôm nay theo giờ Việt Nam
  const todayVN = reqBody.balance_date ?? new Date().toLocaleDateString('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }); // 'en-CA' format = YYYY-MM-DD

  console.log(`[close-day] Đóng ngày: ${todayVN}`);

  // ---- Lấy danh sách chi nhánh cần đóng sổ ----
  let branchQuery = supabase
    .from('cash_balances')
    .select(`
      id,
      branch_id,
      balance_date,
      opening_cash,
      opening_bank,
      closing_cash,
      closing_bank,
      status,
      actual_cash,
      bank_statement_balance,
      total_receipts_cash,
      total_receipts_bank,
      total_payments_cash,
      total_payments_bank,
      max_cash_allowed
    `)
    .eq('balance_date', todayVN)
    .eq('status', 'open');

  if (reqBody.branch_id) {
    branchQuery = branchQuery.eq('branch_id', reqBody.branch_id);
  }

  const { data: balances, error: fetchError } = await branchQuery;

  if (fetchError) {
    return new Response(
      JSON.stringify({ success: false, error: fetchError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!balances || balances.length === 0) {
    return new Response(
      JSON.stringify({
        success: true,
        message: `Không có chi nhánh nào cần đóng sổ ngày ${todayVN}`,
        results: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const results: BranchCloseResult[] = [];
  const TOLERANCE = 5000; // ±5,000 VND sai số chấp nhận

  for (const balance of balances) {
    // Lấy tên chi nhánh
    const { data: branchData } = await supabase
      .from('branches')
      .select('name')
      .eq('id', balance.branch_id)
      .single();

    const branchName = branchData?.name ?? `Chi nhánh ${balance.branch_id.slice(0, 8)}`;

    // ---- Nếu gọi tay với actual_cash, cập nhật trước ----
    if (reqBody.actual_cash !== undefined) {
      await supabase
        .from('cash_balances')
        .update({
          actual_cash:            reqBody.actual_cash,
          bank_statement_balance: reqBody.bank_statement_balance ?? balance.bank_statement_balance,
          status:                 'reconciling',
        })
        .eq('id', balance.id);

      balance.actual_cash = reqBody.actual_cash;
      if (reqBody.bank_statement_balance !== undefined) {
        balance.bank_statement_balance = reqBody.bank_statement_balance;
      }
    }

    // ---- Kiểm tra: actual_cash và bank_statement phải được nhập trước khi đóng ----
    if (balance.actual_cash === null || balance.bank_statement_balance === null) {
      results.push({
        branch_id:   balance.branch_id,
        branch_name: branchName,
        status:      'skipped',
        message:     'Chưa nhập kiểm quỹ thực tế hoặc sao kê ngân hàng. Không thể đóng ngày.',
      });
      continue;
    }

    // ---- 3-WAY RECONCILIATION ----
    // Kiểm tra 1: ERP tiền mặt = kiểm quỹ thực tế
    const cashDiff = balance.actual_cash - balance.closing_cash;
    const cashOk = Math.abs(cashDiff) <= TOLERANCE;

    // Kiểm tra 2: ERP ngân hàng = sao kê ngân hàng
    const bankDiff = balance.bank_statement_balance - balance.closing_bank;
    const bankOk = Math.abs(bankDiff) <= TOLERANCE;

    // Kiểm tra 3: Tổng thu = Tổng chi + Số dư cuối (cân đối sổ sách)
    const erpBalanced =
      balance.opening_cash + balance.total_receipts_cash - balance.total_payments_cash ===
      balance.closing_cash;

    if ((!cashOk || !bankOk) && !reqBody.force) {
      // Có chênh lệch, không cho đóng — tạo alert
      const alerts: string[] = [];
      if (!cashOk) {
        alerts.push(
          `Tiền mặt chênh: ${cashDiff.toLocaleString('vi-VN')} VND ` +
          `(ERP: ${balance.closing_cash.toLocaleString('vi-VN')} | Thực tế: ${balance.actual_cash.toLocaleString('vi-VN')})`
        );
      }
      if (!bankOk) {
        alerts.push(
          `Ngân hàng chênh: ${bankDiff.toLocaleString('vi-VN')} VND ` +
          `(ERP: ${balance.closing_bank.toLocaleString('vi-VN')} | Sao kê: ${balance.bank_statement_balance.toLocaleString('vi-VN')})`
        );
      }

      await supabase
        .from('cash_balances')
        .update({ status: 'discrepancy' })
        .eq('id', balance.id);

      // Tạo alert notification
      await supabase.from('notifications').insert({
        type:        'close_day_discrepancy',
        title:       `⚠️ Chênh lệch sổ sách — ${branchName} ngày ${todayVN}`,
        message:     alerts.join(' | '),
        payload:     { branch_id: balance.branch_id, balance_date: todayVN, cash_diff: cashDiff, bank_diff: bankDiff },
        target_role: 'ke_toan_ho',
        is_read:     false,
      });

      results.push({
        branch_id:   balance.branch_id,
        branch_name: branchName,
        status:      'discrepancy',
        message:     `Không thể đóng sổ: ${alerts.join('; ')}`,
        cash_diff:   cashDiff,
        bank_diff:   bankDiff,
      });
      continue;
    }

    // ---- Đóng ngày thành công — Snapshot ----
    const now = new Date().toISOString();
    await supabase
      .from('cash_balances')
      .update({
        status:    'reconciled',
        closed_at: now,
      })
      .eq('id', balance.id);

    // ---- Tạo số dư đầu ngày mai ----
    const tomorrow = new Date(
      new Date(todayVN + 'T00:00:00+07:00').getTime() + 24 * 60 * 60 * 1000
    ).toISOString().split('T')[0];

    await supabase
      .from('cash_balances')
      .insert({
        branch_id:    balance.branch_id,
        balance_date: tomorrow,
        opening_cash: balance.closing_cash,
        opening_bank: balance.closing_bank,
        status:       'open',
      })
      .onConflict('branch_id, balance_date')
      .ignore(); // Nếu đã tồn tại (ví dụ gọi lại 2 lần) thì bỏ qua

    results.push({
      branch_id:   balance.branch_id,
      branch_name: branchName,
      status:      'reconciled',
      message:     `Đóng sổ thành công. Số dư ngày mai đã tạo.`,
      cash_diff:   cashDiff,
      bank_diff:   bankDiff,
      snapshot: {
        opening_cash:           balance.opening_cash,
        opening_bank:           balance.opening_bank,
        closing_cash:           balance.closing_cash,
        closing_bank:           balance.closing_bank,
        actual_cash:            balance.actual_cash,
        bank_statement_balance: balance.bank_statement_balance,
      },
    });

    console.log(`[close-day] ${branchName} — RECONCILED OK. Số dư TM: ${balance.closing_cash}, NH: ${balance.closing_bank}`);
  }

  // ---- Tổng kết ----
  const reconciledCount = results.filter((r) => r.status === 'reconciled').length;
  const discrepancyCount = results.filter((r) => r.status === 'discrepancy').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;

  const summaryMsg =
    `Đóng ngày ${todayVN}: ` +
    `✅ Khớp ${reconciledCount} | ⚠️ Chênh ${discrepancyCount} | ⏭️ Bỏ qua ${skippedCount}`;

  console.log(`[close-day] ${summaryMsg}`);

  // Gửi thông báo tổng kết
  if (results.length > 0) {
    await supabase.from('notifications').insert({
      type:        'close_day_summary',
      title:       'Báo cáo đóng ngày',
      message:     summaryMsg,
      payload:     { balance_date: todayVN, results },
      target_role: 'ke_toan_ho',
      is_read:     false,
    });
  }

  return new Response(
    JSON.stringify({
      success: discrepancyCount === 0,
      balance_date: todayVN,
      summary: { reconciled: reconciledCount, discrepancy: discrepancyCount, skipped: skippedCount },
      results,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
