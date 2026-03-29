// Dashboard - Trang tổng quan
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';
import type { DashboardStats } from '../types';
import { formatCurrency } from '../utils/helpers';

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data),
    refetchInterval: 60000,
  });

  const cards = [
    { label: 'Xe trong kho', value: stats?.vehicles_in_stock ?? 0, icon: '🏍️', cls: 'blue', unit: 'xe' },
    { label: 'Đơn hàng tháng này', value: stats?.orders_this_month ?? 0, icon: '🛒', cls: 'green', unit: 'đơn' },
    { label: 'Phiếu dịch vụ mở', value: stats?.open_service_tickets ?? 0, icon: '🔧', cls: 'orange', unit: 'phiếu' },
    { label: 'Phụ tùng sắp hết', value: stats?.low_stock_parts ?? 0, icon: '⚠️', cls: 'red', unit: 'loại' },
    { label: 'Doanh thu tháng này', value: formatCurrency(stats?.revenue_this_month ?? 0), icon: '💰', cls: 'purple', unit: '' },
  ];

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">📊 Dashboard Tổng quan</span>
        <span className="text-muted" style={{ fontSize: 13 }}>
          {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
        </span>
      </div>

      <div className="page-content">
        {isLoading ? (
          <div className="loading-center"><div className="spinner" style={{ width: 36, height: 36 }} /></div>
        ) : (
          <div className="stat-grid">
            {cards.map(card => (
              <div className={`stat-card ${card.cls}`} key={card.label}>
                <div className="icon" style={{ float: 'right', width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                  {card.icon}
                </div>
                <div className="label">{card.label}</div>
                <div className="value">{card.value}</div>
                {card.unit && <div className="change">{card.unit}</div>}
              </div>
            ))}
          </div>
        )}

        {/* Shortcuts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <div className="card">
            <div className="card-header"><span className="card-title">🚀 Thao tác nhanh</span></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { href: '/sales', label: '➕ Tạo đơn hàng mới', color: '#2563eb' },
                { href: '/customers', label: '👤 Thêm khách hàng', color: '#16a34a' },
                { href: '/services', label: '🔧 Tạo phiếu dịch vụ', color: '#d97706' },
                { href: '/finance', label: '💸 Ghi nhận thu/chi', color: '#7c3aed' },
              ].map(a => (
                <a
                  key={a.href} href={a.href}
                  style={{ padding: '10px 14px', background: '#f9fafb', borderRadius: 6, textDecoration: 'none', color: a.color, fontWeight: 500, fontSize: 13.5, border: '1px solid #e5e7eb', display: 'block' }}
                >
                  {a.label}
                </a>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">ℹ️ Thông tin hệ thống</span></div>
            <div className="card-body">
              {[
                ['Phiên bản', 'v1.0.0'],
                ['Môi trường', 'Development'],
                ['Database', 'Supabase PostgreSQL'],
                ['Cập nhật lúc', new Date().toLocaleTimeString('vi-VN')],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13.5 }}>
                  <span className="text-muted">{k}</span>
                  <span className="fw-600">{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
