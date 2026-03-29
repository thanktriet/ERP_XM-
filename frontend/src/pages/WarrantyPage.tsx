// Trang Bảo hành & Dịch vụ
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { WarrantyRecord, ServiceRequest } from '../types';
import { formatDate, WARRANTY_STATUS, SERVICE_STATUS } from '../utils/helpers';
import toast from 'react-hot-toast';

export default function WarrantyPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'warranty' | 'service'>('warranty');
  const [statusFilter, setStatusFilter] = useState('');

  const { data: warranties, isLoading: wLoading } = useQuery<WarrantyRecord[]>({
    queryKey: ['warranties', statusFilter],
    queryFn: () => api.get('/warranty', { params: { status: statusFilter || undefined } }).then(r => r.data),
    enabled: tab === 'warranty',
  });

  const { data: services, isLoading: sLoading } = useQuery<ServiceRequest[]>({
    queryKey: ['services', statusFilter],
    queryFn: () => api.get('/warranty/services', { params: { status: statusFilter || undefined } }).then(r => r.data),
    enabled: tab === 'service',
  });

  const updateServiceMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/warranty/services/${id}`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); toast.success('Cập nhật trạng thái thành công'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi'),
  });

  const SERVICE_NEXT: Record<string, string> = {
    received: 'diagnosing', diagnosing: 'repairing', repairing: 'done', done: 'delivered',
  };

  const tabStyle = (t: string) => ({
    padding: '8px 20px', cursor: 'pointer', border: 'none', background: 'none',
    borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
    color: tab === t ? '#2563eb' : '#6b7280', fontWeight: tab === t ? 600 : 400, fontSize: 14,
  });

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">🛡️ Bảo hành & Dịch vụ</span>
        <select className="filter-select" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); }}>
          <option value="">Tất cả trạng thái</option>
          {tab === 'warranty'
            ? Object.entries(WARRANTY_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)
            : Object.entries(SERVICE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)
          }
        </select>
      </div>
      <div className="page-content">
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', marginBottom: 16 }}>
          <button style={tabStyle('warranty')} onClick={() => { setTab('warranty'); setStatusFilter(''); }}>🛡️ Phiếu bảo hành</button>
          <button style={tabStyle('service')} onClick={() => { setTab('service'); setStatusFilter(''); }}>🔧 Phiếu dịch vụ</button>
        </div>

        {tab === 'warranty' && (
          <div className="card">
            <div className="card-header"><span className="card-title">Danh sách phiếu bảo hành</span></div>
            <div className="table-wrap">
              {wLoading ? <div className="loading-center"><div className="spinner" /></div>
                : (warranties?.length ?? 0) === 0 ? <div className="empty-state"><p>Không có phiếu bảo hành</p></div>
                : (
                  <table>
                    <thead><tr><th>Số phiếu</th><th>Khách hàng</th><th>Xe</th><th>Bắt đầu</th><th>Hết hạn</th><th>Trạng thái</th></tr></thead>
                    <tbody>
                      {warranties?.map(w => (
                        <tr key={w.id}>
                          <td><span className="font-mono text-primary">{w.warranty_number}</span></td>
                          <td className="fw-600">{w.customers?.full_name}<br /><span className="text-muted" style={{ fontWeight: 400 }}>{w.customers?.phone}</span></td>
                          <td>{w.inventory_vehicles?.vehicle_models?.brand} {w.inventory_vehicles?.vehicle_models?.model_name}<br />
                            <span className="font-mono text-muted" style={{ fontSize: 12 }}>{w.inventory_vehicles?.vin}</span>
                          </td>
                          <td>{formatDate(w.start_date)}</td>
                          <td className={new Date(w.end_date) < new Date() ? 'text-danger' : 'text-success'}>{formatDate(w.end_date)}</td>
                          <td><span className={`badge ${WARRANTY_STATUS[w.status]?.cls}`}>{WARRANTY_STATUS[w.status]?.label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        )}

        {tab === 'service' && (
          <div className="card">
            <div className="card-header"><span className="card-title">Danh sách phiếu dịch vụ</span></div>
            <div className="table-wrap">
              {sLoading ? <div className="loading-center"><div className="spinner" /></div>
                : (services?.length ?? 0) === 0 ? <div className="empty-state"><p>Không có phiếu dịch vụ</p></div>
                : (
                  <table>
                    <thead><tr><th>Số phiếu</th><th>Khách hàng</th><th>Loại DV</th><th>KTV</th><th>Ngày nhận</th><th>Trạng thái</th><th></th></tr></thead>
                    <tbody>
                      {services?.map(s => (
                        <tr key={s.id}>
                          <td><span className="font-mono text-primary">{s.ticket_number}</span></td>
                          <td className="fw-600">{s.customers?.full_name}<br /><span className="text-muted" style={{ fontWeight: 400 }}>{s.customers?.phone}</span></td>
                          <td>
                            <span className="badge badge-blue">
                              {{ warranty: 'Bảo hành', paid_repair: 'Sửa có trả phí', periodic_maintenance: 'Bảo dưỡng', upgrade: 'Nâng cấp' }[s.service_type] || s.service_type}
                            </span>
                          </td>
                          <td className="text-muted">{s.users?.full_name || 'Chưa phân công'}</td>
                          <td>{formatDate(s.received_date)}</td>
                          <td><span className={`badge ${SERVICE_STATUS[s.status]?.cls}`}>{SERVICE_STATUS[s.status]?.label}</span></td>
                          <td>
                            {SERVICE_NEXT[s.status] && (
                              <button className="btn btn-primary btn-sm"
                                disabled={updateServiceMut.isPending}
                                onClick={() => updateServiceMut.mutate({ id: s.id, status: SERVICE_NEXT[s.status] })}>
                                ✅ Tiếp theo
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
