// ============================================================
// Types cho Module Kế Toán
// Ánh xạ đúng với schema thực tế trong Supabase:
//   - acc_vouchers       (thay thế receipts + payments)
//   - acc_sync_queue     (thay thế amis_sync_queue)
//   - acc_ar_ledger      (thay thế customer_debts)
//   - acc_period_balances(dùng cho tồn quỹ theo tài khoản)
//   - acc_branches       (thay thế branches)
//   - notifications      (tạo mới)
//   - accounting_user_profiles (tạo mới)
//
// Tất cả amount dùng integer VND (NUMERIC(18,0) trong DB)
// Tất cả timestamp lưu UTC, hiển thị convert sang Asia/Ho_Chi_Minh
// ============================================================

// ============================================================
// USERS & ROLES (ánh xạ users.role thực trong DB)
// ============================================================

/** Role trong bảng users — CHECK constraint của DB */
export type UserRole =
  | 'admin'
  | 'manager'
  | 'sales'
  | 'technician'
  | 'accountant'
  | 'warehouse';

/** Role kế toán mở rộng — trong bảng accounting_user_profiles.acc_role */
export type AccRole =
  | 'viewer'           // Chỉ xem báo cáo
  | 'cashier'          // Thu tiền, tạo phiếu thu
  | 'accountant_cn'    // Kế toán chi nhánh
  | 'accountant_ho'    // Kế toán tổng hợp (thấy tất cả CN)
  | 'chief_accountant'; // Kế toán trưởng: duyệt + đóng kỳ

export interface AccountingUserProfile {
  id: string;                        // = users.id
  acc_role: AccRole;
  default_branch_id: string | null;
  default_org_id: string | null;
  preferences: Record<string, unknown>;
  active_period_id: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ACC_BRANCHES (thực tế: bảng acc_branches, không phải branches)
// ============================================================

export type BranchType = 'headquarters' | 'showroom' | 'warehouse' | 'service_center';

export interface AccBranch {
  id: string;
  org_id: string;
  branch_code: string;               // 'MAIN-001', 'HCM-002'
  branch_name: string;
  branch_type: BranchType;
  address: string | null;
  phone: string | null;
  email: string | null;
  manager_id: string | null;
  bank_account: string | null;
  bank_name: string | null;
  cost_center_code: string | null;   // Mã trung tâm CP cho AMIS
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// ACC_VOUCHERS (phiếu thu PT + phiếu chi PC + chứng từ kế toán)
// Đây là bảng TT200-compliant thay thế receipts + payments
// ============================================================

export type VoucherType =
  | 'receipt'           // PT : Phiếu thu
  | 'payment'           // PC : Phiếu chi
  | 'journal'           // BK : Bút ký
  | 'sales_invoice'     // HDB: Hoá đơn bán hàng
  | 'purchase_invoice'  // HDM: Hoá đơn mua hàng
  | 'inventory_in'      // PKN: Phiếu nhập kho
  | 'inventory_out'     // PXK: Phiếu xuất kho
  | 'intercompany'      // NB : Điều chuyển nội bộ
  | 'allocation';       // KB : Kết chuyển cuối kỳ

export type VoucherStatus = 'draft' | 'posted' | 'reversed' | 'cancelled';

export type AmisSyncStatus = 'pending' | 'queued' | 'synced' | 'failed' | 'skipped';

export interface AccVoucher {
  id: string;
  org_id: string;
  branch_id: string;
  voucher_number: string;            // 'PT202603001', 'PC202603001'
  voucher_type: VoucherType;
  voucher_date: string;              // YYYY-MM-DD
  fiscal_period_id: string;
  description: string | null;
  reference_type: string | null;     // 'sales_order' | 'purchase_order' | ...
  reference_id: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  status: VoucherStatus;
  posted_by: string | null;
  posted_at: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
  reverse_of: string | null;
  total_debit: number;
  total_credit: number;
  attachments: unknown[];
  amis_sync_status: AmisSyncStatus;
  amis_voucher_id: string | null;
  amis_synced_at: string | null;
  amis_sync_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Input tạo phiếu thu (voucher_type = 'receipt') qua Express API
export type PaymentMethod = 'bank_transfer' | 'cash' | 'debt';

export interface CreateReceiptInput {
  order_id?: string;                 // reference_id nếu reference_type = 'sales_order'
  customer_id?: string;
  branch_id: string;
  amount: number;                    // = total_debit = total_credit
  payment_method: PaymentMethod;
  bank_ref_code?: string;            // referenceCode từ SEPay — lưu vào description
  note?: string;
  debt_due_date?: string;            // Nếu payment_method = 'debt'
}

// Response từ Express API khi tạo phiếu thu
// Backend trả về AccVoucher + thông tin bổ sung cho UI
export interface Receipt {
  id: string;
  receipt_code: string;              // = voucher_number (PT202603001)
  order_id: string | null;           // = reference_id
  customer_id: string | null;
  branch_id: string;
  amount: number;                    // = total_debit
  payment_method: PaymentMethod;     // trong description hoặc reference_type
  status: VoucherStatus;
  amis_sync_status: AmisSyncStatus;
  note: string | null;               // = description
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Input tạo phiếu chi (voucher_type = 'payment') qua Express API
export type PaymentCategory =
  | 'supplier'
  | 'salary'
  | 'operating'
  | 'transfer_to_ho'
  | 'other';

export interface CreatePaymentInput {
  branch_id: string;
  category: PaymentCategory;
  amount: number;
  description: string;
  recipient?: string;
  note?: string;
}

// ============================================================
// ACC_AR_LEDGER (thay thế customer_debts)
// Append-only — không có updated_at
// ============================================================

export type ArEntryType = 'invoice' | 'receipt' | 'adjustment' | 'reversal';

export interface AccArLedger {
  id: string;
  org_id: string;
  branch_id: string;
  customer_id: string;
  voucher_id: string;
  voucher_date: string;              // YYYY-MM-DD
  due_date: string | null;
  entry_type: ArEntryType;
  debit_amount: number;              // Tăng phải thu
  credit_amount: number;             // Giảm phải thu
  matched_amount: number;
  is_fully_matched: boolean;         // GENERATED: matched_amount >= debit_amount
  reference_number: string | null;
  description: string | null;
  created_at: string;
}

// View v_acc_ar_outstanding — công nợ còn lại
export interface ArOutstandingRow {
  customer_id: string;
  customer_name: string;
  total_debit: number;
  total_credit: number;
  outstanding: number;               // total_debit - total_credit
  overdue_amount: number;
  earliest_due_date: string | null;
}

// ============================================================
// ACC_PERIOD_BALANCES (dùng cho tồn quỹ theo tài khoản)
// closing_debit / closing_credit là GENERATED COLUMNS — không ghi trực tiếp
// ============================================================

export interface AccPeriodBalance {
  id: string;
  org_id: string;
  branch_id: string;
  fiscal_period_id: string;
  account_id: string;
  account_code: string;              // Denormalized: '111', '112', '131'
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;             // GENERATED: GREATEST(0, opening_debit + period_debit - ...)
  closing_credit: number;            // GENERATED: GREATEST(0, opening_credit + ...)
  updated_at: string;
}

// Dashboard tồn quỹ — tổng hợp TK 111 (tiền mặt) + TK 112 (ngân hàng) theo chi nhánh
export interface CashBalanceSummary {
  branch_id: string;
  branch_name: string;
  branch_code: string;
  period_name: string;               // 'Tháng 03/2026'

  cash_111_balance: number;          // Số dư TK 111 (tiền mặt)
  bank_112_balance: number;          // Số dư TK 112 (ngân hàng)

  // Thu ngày (phát sinh Nợ trong kỳ của TK 111 + 112)
  receipts_cash: number;
  receipts_bank: number;
  total_receipts: number;

  // Chi ngày (phát sinh Có trong kỳ của TK 111 + 112)
  payments_cash: number;
  payments_bank: number;
  total_payments: number;

  max_cash_allowed: number;          // Ngưỡng cảnh báo (từ acc_branches hoặc config)
  is_over_threshold: boolean;        // cash_111_balance > max_cash_allowed sau 18:00
  updated_at: string;
}

// Alias để tương thích với CashflowPage.tsx
export type CashBalance = CashBalanceSummary;
export type CashBalanceStatus = 'open' | 'reconciling' | 'reconciled' | 'discrepancy';

// ============================================================
// ACC_SYNC_QUEUE (thay thế amis_sync_queue)
// ============================================================

export type SyncQueueStatus = 'pending' | 'processing' | 'success' | 'failed' | 'skipped';

export interface AccSyncQueue {
  id: string;
  org_id: string;
  branch_id: string;
  config_id: string;
  voucher_id: string;
  status: SyncQueueStatus;
  priority: number;                  // 1 = cao nhất (PT/PC), 5 = mặc định
  attempt_count: number;
  max_attempts: number;              // Default 3
  next_retry_at: string | null;
  amis_response: unknown | null;
  error_message: string | null;
  error_code: string | null;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// ============================================================
// NOTIFICATIONS (bảng mới tạo)
// ============================================================

export type NotificationSeverity = 'info' | 'warning' | 'error' | 'success';

export type NotificationType =
  | 'payment_received'    // SEPay webhook matched thành công
  | 'payment_unmatched'   // Chuyển khoản vào không khớp đơn
  | 'amis_sync_done'      // Batch sync AMIS xong
  | 'amis_sync_failed'    // Item trong queue thất bại
  | 'close_day_ok'        // Đóng ngày thành công
  | 'close_day_mismatch'; // Chênh lệch sổ sách

export interface Notification {
  id: string;
  org_id: string;
  type: NotificationType | string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  link_path: string | null;          // '/payment/uuid' — điều hướng khi click
  link_label: string | null;
  reference_type: string | null;
  reference_id: string | null;
  branch_id: string | null;          // null = tất cả chi nhánh
  target_roles: string[];
  is_global: boolean;
  created_at: string;
  expires_at: string | null;
  is_read?: boolean;                 // Từ view v_unread_notifications
}

// ============================================================
// SALES_ORDERS — cấu trúc thực tế trong DB
// (order_number, không phải order_code)
// ============================================================

export type SalesOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'deposit_paid'
  | 'full_paid'
  | 'invoice_requested'
  | 'invoice_approved'
  | 'pdi_pending'
  | 'pdi_done'
  | 'delivered'
  | 'cancelled';

export interface SalesOrderSummary {
  id: string;
  order_number: string;              // ⚠️ thực tế là order_number, không phải order_code
  customer_id: string;
  customer_name?: string;            // Join từ customers
  customer_phone?: string;
  total_amount: number;
  deposit_amount: number;
  payment_method: string | null;
  status: SalesOrderStatus;
  order_date: string;
  delivery_date: string | null;
  vehicle_model?: string;            // Join từ inventory_vehicles
  vehicle_color?: string;
  created_at: string;
}

// Số tiền còn lại cần thu (tính từ API)
export interface OrderPaymentStatus {
  order_id: string;
  order_number: string;
  total_amount: number;
  already_paid: number;              // Tổng acc_vouchers type=receipt đã posted
  remaining: number;                 // total_amount - already_paid
}

// ============================================================
// SEPay WEBHOOK
// ============================================================

export interface SePayWebhookPayload {
  id: number;
  gateway: string;
  transactionDate: string;           // 'YYYY-MM-DD HH:mm:ss'
  accountNumber: string;
  subAccount: string | null;
  code: string | null;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  accumulated: number;
  referenceCode: string;             // Idempotency key
  description: string;
}

export type SePayMatchResult =
  | { type: 'matched_full';    order_id: string; voucher_id: string }
  | { type: 'matched_partial'; order_id: string; voucher_id: string; paid: number; remaining: number }
  | { type: 'matched_excess';  order_id: string; voucher_id: string; excess: number }
  | { type: 'not_matched';     reference_code: string };

// ============================================================
// AMIS — Payload gửi lên AMIS MISA
// ============================================================

export interface AmisVoucherDetailLine {
  AccountCode: string;               // TK kế toán theo TT200
  DebitAmount: number;
  CreditAmount: number;
  Description: string;
  EmployeeCode?: string;
  CustomerCode?: string;
}

export interface AmisVoucherPayload {
  VoucherType: string;               // 'PT' | 'PC'
  VoucherCode: string;               // voucher_number
  VoucherDate: string;               // YYYY-MM-DD
  RefNo: string;
  Description: string;
  CurrencyCode: 'VND';
  ExchangeRate: 1;
  Amount: number;
  Details: AmisVoucherDetailLine[];
}

// Định khoản tự động
export const VOUCHER_ACCOUNT_MAPPING: Record<string, { debit: string; credit: string; description: string }> = {
  'receipt_bank_transfer':  { debit: '112', credit: '131', description: 'Thu tiền chuyển khoản bán xe' },
  'receipt_cash':           { debit: '111', credit: '131', description: 'Thu tiền mặt bán xe' },
  'receipt_deposit_cash':   { debit: '111', credit: '131', description: 'Thu tiền cọc (tiền mặt)' },
  'receipt_deposit_bank':   { debit: '112', credit: '131', description: 'Thu tiền cọc (chuyển khoản)' },
  'payment_supplier':       { debit: '331', credit: '111', description: 'Chi trả nhà cung cấp' },
  'payment_salary':         { debit: '334', credit: '111', description: 'Chi lương nhân viên' },
  'payment_operating':      { debit: '642', credit: '111', description: 'Chi phí hoạt động' },
  'payment_transfer_to_ho': { debit: '1368', credit: '111', description: 'Nộp tiền về HO' },
  'payment_other':          { debit: '811', credit: '111', description: 'Chi phí khác' },
};

// ============================================================
// SEPay QR
// ============================================================

export interface SePayQRParams {
  bank: string;                      // 'TCB', 'VCB', 'MB', ...
  account_number: string;
  amount: number;
  description: string;               // Nội dung = order_number
  template?: 'compact' | 'compact2' | 'qr_only' | 'print';
}

export function buildSePayQRUrl(params: SePayQRParams): string {
  const p = new URLSearchParams({
    bank:     params.bank,
    acc:      params.account_number,
    amount:   String(params.amount),
    des:      params.description,
    template: params.template ?? 'compact2',
  });
  return `https://qr.sepay.vn/img?${p.toString()}`;
}

// ============================================================
// Helpers hiển thị
// ============================================================

export function formatVND(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency: 'VND',
  }).format(amount);
}

export function toVNTime(utcString: string): Date {
  return new Date(
    new Date(utcString).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })
  );
}

export function formatVNDateTime(utcString: string): string {
  if (!utcString) return '—';
  return new Date(utcString).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatVNDate(dateStr: string): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
