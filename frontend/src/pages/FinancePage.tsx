// Trang Thu Chi Tài chính
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { FinanceTransaction, PaginatedResponse } from '../types';
import { formatCurrency, formatDate, PAYMENT_METHOD } from '../utils/helpers';

export default function FinancePage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: summary } = useQuery({
    queryKey: ['finance-summary'],
    queryFn: () => api.get('/finance/summary').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data, isLoading } = useQuery<PaginatedResponse<FinanceTransaction>>({
    queryKey: ['finance', typeFilter, page],
    queryFn: () => api.get('/finance', { params: { type: typeFilter || undefined, page, limit: 15 } }).then(r => r.data),
  });

  const totalPages = Math.ceil((data?.total || 0) / 15);

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">💰 Quản lý Thu Chi</span>
      </div>
      <div className="page-content">
        {/* Summary */}
        {summary && (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 24 }}>
            <div className="stat-card green">
              <div className="label">Tổng Thu - {summary.month}</div>
              <div className="value" style={{ fontSize: 22 }}>{formatCurrency(summary.income)}</div>
            </div>
            <div className="stat-card red">
              <div className="label">Tổng Chi - {summary.month}</div>
              <div className="value" style={{ fontSize: 22 }}>{formatCurrency(summary.expense)}</div>
            </div>
            <div className={`stat-card ${summary.profit >= 0 ? 'blue' : 'orange'}`}>
              <div className="label">Lợi nhuận - {summary.month}</div>
              <div className="value" style={{ fontSize: 22, color: summary.profit >= 0 ? '#16a34a' : '#dc2626' }}>
                {summary.profit >= 0 ? '+' : ''}{formatCurrency(summary.profit)}
              </div>
            </div>
          </div>
        )}

        {/* Danh sách giao dịch */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Lịch sử giao dịch ({data?.total ?? 0})</span>
            <select className="filter-select" value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              <option value="income">💚 Thu</option>
              <option value="expense">🔴 Chi</option>
            </select>
          </div>
          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : (data?.data?.length ?? 0) === 0 ? (
              <div className="empty-state"><p>Không có giao dịch nào</p></div>
            ) : (
              <table>
                <thead>
                  <tr><th>Mã GD</th><th>Loại</th><th>Danh mục</th><th>Phương thức TT</th><th>Mô tả</th><th>Ngày</th><th className="text-right">Số tiền</th></tr>
                </thead>
                <tbody>
                  {data?.data.map(t => (
                    <tr key={t.id}>
                      <td><span className="font-mono" style={{ fontSize: 12 }}>{t.transaction_number}</span></td>
                      <td>
                        <span className={`badge ${t.type === 'income' ? 'badge-green' : 'badge-red'}`}>
                          {t.type === 'income' ? '💚 Thu' : '🔴 Chi'}
                        </span>
                      </td>
                      <td className="text-muted">{t.category}</td>
                      <td>{PAYMENT_METHOD[t.payment_method] || t.payment_method}</td>
                      <td className="text-muted" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description || '-'}</td>
                      <td>{formatDate(t.transaction_date)}</td>
                      <td className="text-right fw-600" style={{ color: t.type === 'income' ? '#16a34a' : '#dc2626' }}>
                        {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">Trang {page}/{totalPages}</span>
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
