// ============================================================
// Dashboard Tồn Quỹ — /accounting/cashflow
// Realtime, phân quyền branch theo role
// Cảnh báo đỏ nếu sau 18:00 quỹ > max_cash_allowed
// ============================================================

import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../store/authStore';
import api from '../services/api';
import type { CashBalance, CashBalanceStatus } from '../types/accounting';
import { formatVND, formatVNDateTime } from '../types/accounting';

// ---- Kiểm tra sau 18:00 giờ VN ----
function isAfterAlertTime(): boolean {
  const h = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false }),
    10
  );
  return h >= 18;
}

// ---- Types ----
interface BranchRow {
  id: string;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  total_receipts_cash: number;
  total_receipts_bank: number;
  total_receipts: number;
  paid_to_ho: number;
  closing_cash: number;
  closing_bank: number;
  max_cash_allowed: number;
  status: CashBalanceStatus;
  is_over_threshold: boolean;
  updated_at: string;
}

// Badge trạng thái
const STATUS_MAP: Record<CashBalanceStatus, { label: string; bg: string; color: string }> = {
  open:        { label: 'Đang mở',    bg: '#dbeafe', color: '#1d4ed8' },
  reconciling: { label: 'Đang đối',   bg: '#fef9c3', color: '#92400e' },
  reconciled:  { label: 'Đã khớp ✓', bg: '#dcfce7', color: '#15803d' },
  discrepancy: { label: 'Chênh lệch', bg: '#fee2e2', color: '#b91c1c' },
};

// ============================================================
export default function CashflowPage() {
  const { user } = useAuthStore();
  const [rows, setRows] = useState<BranchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState(new Date());
  const [isAlertTime, setIsAlertTime] = useState(isAfterAlertTime());

  // Cập nhật cờ alert mỗi phút
  useEffect(() => {
    const t = setInterval(() => setIsAlertTime(isAfterAlertTime()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Phân quyền: accountant_cn (role: accountant) chỉ thấy branch mình
  // admin / manager thấy tất cả chi nhánh
  const canSeeAll = ['admin', 'manager'].includes(user?.role ?? '');

  // ---- Fetch từ Express API ----
  // API trả về CashBalanceSummary: tổng hợp TK 111 + 112 từ acc_period_balances
  const fetchData = useCallback(async () => {
    try {
      const { data } = await api.get('/accounting/cashflow/today');
      const items: CashBalance[] = data?.data ?? (Array.isArray(data) ? data : []);

      const mapped: BranchRow[] = items.map((row: CashBalance) => {
        const overThreshold = isAlertTime && row.cash_111_balance > row.max_cash_allowed;
        return {
          id:                  row.branch_id,   // acc_period_balances không có id riêng per-branch
          branch_id:           row.branch_id,
          branch_name:         row.branch_name,
          branch_code:         row.branch_code,
          total_receipts_cash: row.receipts_cash,
          total_receipts_bank: row.receipts_bank,
          total_receipts:      row.total_receipts,
          paid_to_ho:          row.payments_cash,
          closing_cash:        row.cash_111_balance,
          closing_bank:        row.bank_112_balance,
          max_cash_allowed:    row.max_cash_allowed,
          status:              'open' as CashBalanceStatus,  // acc_period_balances không có status field
          is_over_threshold:   overThreshold,
          updated_at:          row.updated_at,
        };
      });

      setRows(mapped);
      setLastRefreshed(new Date());
    } catch (err) {
      console.error('[cashflow] Lỗi tải tồn quỹ:', err);
    } finally {
      setLoading(false);
    }
  }, [isAlertTime]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ---- Realtime subscription ----
  // Lắng nghe acc_vouchers (receipt/payment posted) → refresh tồn quỹ
  useEffect(() => {
    // Realtime chỉ hoạt động khi đã cấu hình VITE_SUPABASE_URL trong .env.local
    if (!supabase) return;

    const channel = supabase
      .channel('cashflow_watch')
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'acc_period_balances'
      }, fetchData)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'acc_vouchers',
        filter: 'status=eq.posted'
      },
        () => setTimeout(fetchData, 1000) // delay nhỏ để trigger DB cập nhật period_balances
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData]);

  // ---- Summary ----
  const summary = useMemo(() => ({
    totalReceipts: rows.reduce((s, r) => s + r.total_receipts, 0),
    totalCash:     rows.reduce((s, r) => s + r.closing_cash, 0),
    alertCount:    rows.filter((r) => r.is_over_threshold).length,
    openCount:     rows.filter((r) => r.status === 'open').length,
  }), [rows]);

  // ============================================================
  return (
    <div style={{ padding: '24px 24px 40px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>Tồn Quỹ & Doanh Thu</h1>
          <p style={{ fontSize: 13, color: '#9ca3af', margin: 0 }}>
            Ngày {new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
            {' · '}Cập nhật{' '}
            <span style={{ color: '#6b7280', fontWeight: 500 }}>
              {lastRefreshed.toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
            </span>
            {' · '}
            <span style={{ color: '#22c55e', fontSize: 12 }}>● Realtime</span>
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {summary.alertCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c', fontSize: 13, padding: '6px 12px', borderRadius: 20, fontWeight: 500 }}>
              🔴 {summary.alertCount} CN quỹ vượt mức
            </span>
          )}
          <button
            onClick={fetchData}
            title="Làm mới"
            style={{ padding: '6px 10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#6b7280' }}
          >
            🔄
          </button>
        </div>
      </div>

      {/* Summary cards — chỉ hiện cho ke_toan_ho+ */}
      {canSeeAll && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Tổng thu hôm nay',  value: formatVND(summary.totalReceipts), icon: '💰', bg: '#dcfce7', border: '#bbf7d0' },
            { label: 'Tổng tồn quỹ TM',   value: formatVND(summary.totalCash),     icon: '🏦', bg: '#dbeafe', border: '#bfdbfe' },
            { label: 'Chi nhánh đang mở', value: String(summary.openCount),         icon: '🏪', bg: '#f3e8ff', border: '#e9d5ff' },
            { label: 'Cảnh báo quỹ',      value: String(summary.alertCount),        icon: summary.alertCount > 0 ? '⚠️' : '✅', bg: summary.alertCount > 0 ? '#fee2e2' : '#f0fdf4', border: summary.alertCount > 0 ? '#fca5a5' : '#bbf7d0' },
          ].map((c) => (
            <div key={c.label} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{c.icon}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>{c.label}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#1f2937' }}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Bảng */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, gap: 12 }}>
          <div style={{ width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          <span style={{ color: '#9ca3af', fontSize: 14 }}>Đang tải...</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
          <p style={{ margin: 0 }}>Chưa có dữ liệu tồn quỹ hôm nay.</p>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 8px rgba(0,0,0,0.06)', border: '1px solid #f3f4f6', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                  {['Chi nhánh', 'Thu ngày', 'Đã nộp HO', 'Còn trong quỹ', 'Trạng thái', 'Cập nhật'].map((h, i) => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: i === 0 ? 'left' : i >= 4 ? 'center' : 'right', fontWeight: 600, color: '#6b7280', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const over = row.is_over_threshold;
                  const excess = row.closing_cash - row.max_cash_allowed;
                  const statusInfo = STATUS_MAP[row.status] ?? STATUS_MAP.open;
                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f9fafb', background: over ? '#fff1f2' : '#fff', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = over ? '#ffe4e6' : '#f9fafb')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = over ? '#fff1f2' : '#fff')}
                    >
                      {/* Chi nhánh */}
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {over && <span title={`Vượt ${formatVND(excess)}`} style={{ fontSize: 14 }}>🔴</span>}
                          <div>
                            <div style={{ fontWeight: 600, color: '#111827' }}>{row.branch_name}</div>
                            <div style={{ fontSize: 12, color: '#9ca3af' }}>{row.branch_code}</div>
                          </div>
                        </div>
                      </td>

                      {/* Thu ngày */}
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ fontWeight: 500, color: '#111827' }}>{formatVND(row.total_receipts)}</div>
                        <div style={{ fontSize: 11, color: '#9ca3af' }}>
                          TM: {formatVND(row.total_receipts_cash)} · CK: {formatVND(row.total_receipts_bank)}
                        </div>
                      </td>

                      {/* Đã nộp HO */}
                      <td style={{ padding: '12px 16px', textAlign: 'right', color: '#4b5563' }}>
                        {formatVND(row.paid_to_ho)}
                      </td>

                      {/* Còn trong quỹ */}
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: over ? '#b91c1c' : '#1d4ed8' }}>
                          {formatVND(row.closing_cash)}
                        </div>
                        {over && (
                          <div style={{ fontSize: 11, color: '#ef4444' }}>Vượt {formatVND(excess)}</div>
                        )}
                      </td>

                      {/* Trạng thái */}
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span style={{ padding: '4px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: statusInfo.bg, color: statusInfo.color }}>
                          {statusInfo.label}
                        </span>
                      </td>

                      {/* Cập nhật */}
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#9ca3af', fontSize: 12 }}>
                        {formatVNDateTime(row.updated_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Footer tổng — chỉ ke_toan_ho+ và > 1 chi nhánh */}
              {canSeeAll && rows.length > 1 && (
                <tfoot>
                  <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                    <td style={{ padding: '10px 16px', fontWeight: 600, color: '#374151' }}>Tổng cộng</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#374151' }}>
                      {formatVND(summary.totalReceipts)}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', color: '#9ca3af' }}>—</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#1d4ed8', fontSize: 15 }}>
                      {formatVND(summary.totalCash)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* Legend cảnh báo */}
      {isAlertTime && (
        <p style={{ marginTop: 12, fontSize: 12, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 2, display: 'inline-block' }} />
          Hàng đỏ: quỹ tiền mặt vượt mức cho phép sau 18:00 — cần nộp về HO
        </p>
      )}
    </div>
  );
}
