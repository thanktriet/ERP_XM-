// Trang Quản lý Khách hàng
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { Customer, PaginatedResponse } from '../types';
import { formatDate } from '../utils/helpers';
import toast from 'react-hot-toast';

type FormState = {
  full_name: string;
  phone: string;
  email: string;
  id_card: string;
  date_of_birth: string;
  address: string;
  province: string;
  district: string;
  customer_type: 'individual' | 'business';
  company_name: string;
  tax_code: string;
  notes: string;
};

const INITIAL_FORM: FormState = {
  full_name: '',
  phone: '',
  email: '',
  id_card: '',
  date_of_birth: '',
  address: '',
  province: '',
  district: '',
  customer_type: 'individual',
  company_name: '',
  tax_code: '',
  notes: '',
};

function fromCustomer(c: Customer): FormState {
  return {
    full_name:     c.full_name,
    phone:         c.phone,
    email:         c.email         ?? '',
    id_card:       c.id_card       ?? '',
    date_of_birth: c.date_of_birth ?? '',
    address:       c.address       ?? '',
    province:      c.province      ?? '',
    district:      c.district      ?? '',
    customer_type: c.customer_type,
    company_name:  c.company_name  ?? '',
    tax_code:      c.tax_code      ?? '',
    notes:         c.notes         ?? '',
  };
}

export default function CustomersPage() {
  const qc = useQueryClient();
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [modal, setModal]     = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm]       = useState<FormState>(INITIAL_FORM);

  const f = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: val }));

  const { data, isLoading } = useQuery<PaginatedResponse<Customer>>({
    queryKey: ['customers', search, page],
    queryFn: () => api.get('/customers', { params: { search, page, limit: 15 } }).then(r => r.data),
  });

  const createMut = useMutation({
    mutationFn: (body: FormState) => api.post('/customers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setModal(null);
      toast.success('Thêm khách hàng thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi khi thêm khách hàng'),
  });

  const updateMut = useMutation({
    mutationFn: (body: FormState) => api.put(`/customers/${editing?.id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setModal(null);
      toast.success('Cập nhật thành công');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi khi cập nhật'),
  });

  const openCreate = () => { setForm(INITIAL_FORM); setEditing(null); setModal('create'); };
  const openEdit   = (c: Customer) => { setEditing(c); setForm(fromCustomer(c)); setModal('edit'); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    modal === 'create' ? createMut.mutate(form) : updateMut.mutate(form);
  };

  const totalPages = Math.ceil((data?.total || 0) / 15);
  const isBusiness = form.customer_type === 'business';

  return (
    <>
      <div className="topbar">
        <span className="topbar-title">👥 Quản lý Khách hàng</span>
        <button className="btn btn-primary" onClick={openCreate}>+ Thêm khách hàng</button>
      </div>

      <div className="page-content">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Danh sách khách hàng ({data?.total ?? 0})</span>
            <div className="search-box" style={{ minWidth: 280 }}>
              <span>🔍</span>
              <input
                placeholder="Tìm theo tên, SĐT, mã KH, email..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          <div className="table-wrap">
            {isLoading ? (
              <div className="loading-center"><div className="spinner" /></div>
            ) : (data?.data?.length ?? 0) === 0 ? (
              <div className="empty-state"><p>Không có khách hàng nào</p></div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Mã KH</th>
                    <th>Họ tên</th>
                    <th>Điện thoại</th>
                    <th>Email</th>
                    <th>Địa chỉ</th>
                    <th>Loại</th>
                    <th>Điểm tích lũy</th>
                    <th>Ngày tạo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data?.data.map(c => (
                    <tr key={c.id}>
                      <td><span className="font-mono text-primary">{c.customer_code}</span></td>
                      <td className="fw-600">{c.full_name}</td>
                      <td>{c.phone}</td>
                      <td className="text-muted">{c.email || '-'}</td>
                      <td className="text-muted">
                        {[c.district, c.province].filter(Boolean).join(', ') || c.address || '-'}
                      </td>
                      <td>
                        <span className={`badge ${c.customer_type === 'business' ? 'badge-blue' : 'badge-gray'}`}>
                          {c.customer_type === 'business' ? '🏢 Doanh nghiệp' : '👤 Cá nhân'}
                        </span>
                      </td>
                      <td className="text-center">{c.loyalty_points}</td>
                      <td className="text-muted">{formatDate(c.created_at)}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>✏️ Sửa</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <span className="pagination-info">Trang {page}/{totalPages} · {data?.total} khách hàng</span>
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${page === p ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </div>
      </div>

      {/* Modal thêm / sửa */}
      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {modal === 'create' ? '➕ Thêm khách hàng' : `✏️ Sửa khách hàng — ${editing?.customer_code}`}
              </span>
              <button className="modal-close" onClick={() => setModal(null)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">

                {/* ── Thông tin cơ bản ── */}
                <p className="form-section-title">Thông tin cơ bản</p>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Họ tên <span className="required">*</span></label>
                    <input
                      className="form-control"
                      required
                      placeholder="Nguyễn Văn A"
                      value={form.full_name}
                      onChange={e => f('full_name', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Số điện thoại <span className="required">*</span></label>
                    <input
                      className="form-control"
                      required
                      placeholder="0901234567"
                      value={form.phone}
                      onChange={e => f('phone', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email</label>
                    <input
                      className="form-control"
                      type="email"
                      placeholder="example@email.com"
                      value={form.email}
                      onChange={e => f('email', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Loại khách hàng</label>
                    <select
                      className="form-control"
                      value={form.customer_type}
                      onChange={e => f('customer_type', e.target.value as 'individual' | 'business')}
                    >
                      <option value="individual">👤 Cá nhân</option>
                      <option value="business">🏢 Doanh nghiệp</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">CCCD / CMND</label>
                    <input
                      className="form-control"
                      placeholder="012345678901"
                      value={form.id_card}
                      onChange={e => f('id_card', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Ngày sinh</label>
                    <input
                      className="form-control"
                      type="date"
                      value={form.date_of_birth}
                      onChange={e => f('date_of_birth', e.target.value)}
                    />
                  </div>
                </div>

                {/* ── Địa chỉ ── */}
                <p className="form-section-title">Địa chỉ</p>
                <div className="form-group">
                  <label className="form-label">Địa chỉ chi tiết</label>
                  <input
                    className="form-control"
                    placeholder="Số nhà, tên đường, phường/xã"
                    value={form.address}
                    onChange={e => f('address', e.target.value)}
                  />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="form-label">Quận / Huyện</label>
                    <input
                      className="form-control"
                      placeholder="Quận 1"
                      value={form.district}
                      onChange={e => f('district', e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tỉnh / Thành phố</label>
                    <input
                      className="form-control"
                      placeholder="TP. Hồ Chí Minh"
                      value={form.province}
                      onChange={e => f('province', e.target.value)}
                    />
                  </div>
                </div>

                {/* ── Thông tin doanh nghiệp (chỉ hiện khi chọn Doanh nghiệp) ── */}
                {isBusiness && (
                  <>
                    <p className="form-section-title">Thông tin doanh nghiệp</p>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Tên công ty <span className="required">*</span></label>
                        <input
                          className="form-control"
                          placeholder="Công ty TNHH ABC"
                          required={isBusiness}
                          value={form.company_name}
                          onChange={e => f('company_name', e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Mã số thuế</label>
                        <input
                          className="form-control"
                          placeholder="0123456789"
                          value={form.tax_code}
                          onChange={e => f('tax_code', e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* ── Ghi chú ── */}
                <div className="form-group">
                  <label className="form-label">Ghi chú</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder="Ghi chú thêm về khách hàng..."
                    value={form.notes}
                    onChange={e => f('notes', e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Huỷ</button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createMut.isPending || updateMut.isPending}
                >
                  {(createMut.isPending || updateMut.isPending) ? 'Đang lưu...' : 'Lưu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
