// PromotionsPage.tsx — Quản lý Khuyến Mãi & Quà Tặng
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../services/api';
import type { Promotion, PromoStats, PromoUsage, PromoType } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n?: number | null) =>
  n != null ? n.toLocaleString('vi-VN') + ' ₫' : '—';

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('vi-VN') : '—';

const isExpired  = (p: Promotion) => new Date(p.valid_until) < new Date();
const isNotStart = (p: Promotion) => new Date(p.valid_from)  > new Date();
const isExpiring = (p: Promotion) => {
  const diff = new Date(p.valid_until).getTime() - Date.now();
  return diff > 0 && diff < 7 * 24 * 3600 * 1000;
};

const PROMO_TYPE_LABEL: Record<PromoType, string> = {
  percent: '% Giảm giá',
  fixed:   'Giảm tiền cố định',
  gift:    'Tặng quà',
  combo:   'Combo ưu đãi',
};
const PROMO_TYPE_COLOR: Record<PromoType, string> = {
  percent: 'badge-blue',
  fixed:   'badge-green',
  gift:    'badge-purple',
  combo:   'badge-orange',
};

const BLANK_FORM = {
  promo_code:        '',
  name:              '',
  description:       '',
  promo_type:        'percent' as PromoType,
  discount_percent:  0,
  discount_amount:   0,
  min_order_amount:  0,
  max_discount_cap:  '',
  valid_from:        '',
  valid_until:       '',
  is_active:         true,
  usage_limit:       '',
  gift_item_id:      '',
  gift_quantity:     1,
  applicable_brands: '',
  note:              '',
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function PromotionsPage() {
  const qc = useQueryClient();

  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatus]   = useState('all');
  const [page,       setPage]       = useState(1);

  const [modalOpen,  setModalOpen]  = useState(false);
  const [editData,   setEditData]   = useState<Promotion | null>(null);
  const [detailItem, setDetail]     = useState<Promotion | null>(null);
  const [form,       setForm]       = useState({ ...BLANK_FORM });

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery<PromoStats>({
    queryKey: ['promo-stats'],
    queryFn: () => api.get('/promotions/stats').then(r => r.data),
    staleTime: 30000,
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ['promotions', search, typeFilter, statusFilter, page],
    queryFn: () =>
      api.get('/promotions', {
        params: {
          search:  search  || undefined,
          type:    typeFilter || undefined,
          status:  statusFilter,
          page, limit: 15,
        },
      }).then(r => r.data),
    staleTime: 15000,
  });

  const promos: Promotion[] = listData?.data ?? [];
  const total: number       = listData?.total ?? 0;
  const totalPages          = Math.max(1, Math.ceil(total / 15));

  const { data: detailFull, isLoading: loadingDetail } = useQuery({
    queryKey: ['promo-detail', detailItem?.id],
    queryFn: () => api.get(`/promotions/${detailItem!.id}`).then(r => r.data),
    enabled: !!detailItem,
  });

  const { data: giftData } = useQuery({
    queryKey: ['gift-items-dropdown'],
    queryFn: () => api.get('/inventory/gift-items', { params: { limit: 200 } }).then(r => r.data),
    staleTime: 60000,
  });
  const giftItems = giftData?.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['promotions'] });
    qc.invalidateQueries({ queryKey: ['promo-stats'] });
  };

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/promotions', body).then(r => r.data),
    onSuccess: () => { toast.success('Đã tạo chương trình khuyến mãi'); closeModal(); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo khuyến mãi'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.put(`/promotions/${id}`, body).then(r => r.data),
    onSuccess: () => { toast.success('Đã cập nhật'); closeModal(); invalidate(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi cập nhật'),
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => api.patch(`/promotions/${id}/toggle`).then(r => r.data),
    onSuccess: (d) => {
      toast.success(d.is_active ? '✅ Đã kích hoạt' : '⏸ Đã tắt');
      invalidate();
      if (detailItem?.id === d.id) setDetail(prev => prev ? { ...prev, is_active: d.is_active } : prev);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi'),
  });

  // ── Helpers modal ──────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditData(null);
    setForm({ ...BLANK_FORM });
    setModalOpen(true);
  };

  const openEdit = (p: Promotion) => {
    setEditData(p);
    setForm({
      promo_code:        p.promo_code,
      name:              p.name,
      description:       p.description ?? '',
      promo_type:        p.promo_type,
      discount_percent:  p.discount_percent,
      discount_amount:   p.discount_amount,
      min_order_amount:  p.min_order_amount,
      max_discount_cap:  p.max_discount_cap != null ? String(p.max_discount_cap) : '',
      valid_from:        p.valid_from,
      valid_until:       p.valid_until,
      is_active:         p.is_active,
      usage_limit:       p.usage_limit != null ? String(p.usage_limit) : '',
      gift_item_id:      p.gift_item_id ?? '',
      gift_quantity:     p.gift_quantity ?? 1,
      applicable_brands: p.applicable_brands?.join(', ') ?? '',
      note:              p.note ?? '',
    });
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditData(null); };

  const setF = (k: keyof typeof BLANK_FORM, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = () => {
    const body = {
      ...form,
      max_discount_cap:  form.max_discount_cap  ? Number(form.max_discount_cap)  : null,
      usage_limit:       form.usage_limit        ? Number(form.usage_limit)        : null,
      applicable_brands: form.applicable_brands
        ? form.applicable_brands.split(',').map(s => s.trim()).filter(Boolean)
        : null,
      gift_item_id: form.gift_item_id || null,
    };
    if (editData) updateMut.mutate({ id: editData.id, body });
    else          createMut.mutate(body);
  };

  const isPending = createMut.isPending || updateMut.isPending;

  // ── Tính toán hiển thị ────────────────────────────────────────────────────
  const usageHistory: PromoUsage[] = detailFull?.usage_history ?? [];

  const progressPct = useMemo(() => {
    if (!detailFull) return 0;
    if (!detailFull.usage_limit) return 0;
    return Math.min(100, Math.round((detailFull.usage_count / detailFull.usage_limit) * 100));
  }, [detailFull]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="page-container">
      {/* ══ TIÊU ĐỀ ══ */}
      <div className="page-header">
        <div>
          <h1 className="page-title">🎉 Khuyến Mãi & Quà Tặng</h1>
          <p className="page-subtitle">Quản lý chương trình khuyến mãi, chiết khấu và quà tặng kèm</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>
          + Tạo chương trình
        </button>
      </div>

      {/* ══ STAT CARDS ══ */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 20 }}>
        <div className="stat-card">
          <div className="stat-icon">📋</div>
          <div className="stat-info">
            <div className="stat-value">{stats?.total ?? '—'}</div>
            <div className="stat-label">Tổng chương trình</div>
          </div>
        </div>
        <div className="stat-card stat-card-success">
          <div className="stat-icon">✅</div>
          <div className="stat-info">
            <div className="stat-value">{stats?.active ?? '—'}</div>
            <div className="stat-label">Đang hoạt động</div>
          </div>
        </div>
        <div className="stat-card stat-card-warning">
          <div className="stat-icon">⏳</div>
          <div className="stat-info">
            <div className="stat-value">{stats?.expiring_soon ?? '—'}</div>
            <div className="stat-label">Sắp hết hạn (7 ngày)</div>
          </div>
        </div>
        <div className="stat-card stat-card-info">
          <div className="stat-icon">💸</div>
          <div className="stat-info">
            <div className="stat-value">{fmt(stats?.total_discount)}</div>
            <div className="stat-label">Tổng chiết khấu đã dùng</div>
          </div>
        </div>
      </div>

      {/* ══ BỘ LỌC ══ */}
      <div className="filter-bar" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ width: 240 }}
          placeholder="🔍 Tìm tên, mã KM..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
        <select className="input" style={{ width: 160 }} value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); setPage(1); }}>
          <option value="">Tất cả loại</option>
          <option value="percent">% Giảm giá</option>
          <option value="fixed">Giảm tiền cố định</option>
          <option value="gift">Tặng quà</option>
          <option value="combo">Combo</option>
        </select>
        <select className="input" style={{ width: 160 }} value={statusFilter}
          onChange={e => { setStatus(e.target.value); setPage(1); }}>
          <option value="all">Tất cả trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Đã tắt</option>
          <option value="expired">Đã hết hạn</option>
        </select>
      </div>

      {/* ══ BẢNG DANH SÁCH ══ */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Mã KM</th>
              <th>Tên chương trình</th>
              <th>Loại</th>
              <th>Ưu đãi</th>
              <th>Hiệu lực</th>
              <th style={{ textAlign: 'center' }}>Lượt dùng</th>
              <th style={{ textAlign: 'center' }}>Trạng thái</th>
              <th style={{ textAlign: 'center' }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>
                <div className="spinner" />
              </td></tr>
            ) : promos.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#888' }}>
                Chưa có chương trình khuyến mãi nào
              </td></tr>
            ) : promos.map(p => {
              const expired   = isExpired(p);
              const notStart  = isNotStart(p);
              const expiring  = isExpiring(p);

              let statusBadge = <span className="badge badge-green">Đang chạy</span>;
              if (!p.is_active)  statusBadge = <span className="badge badge-gray">Đã tắt</span>;
              else if (expired)  statusBadge = <span className="badge badge-red">Hết hạn</span>;
              else if (notStart) statusBadge = <span className="badge badge-blue">Chưa bắt đầu</span>;
              else if (expiring) statusBadge = <span className="badge badge-orange">Sắp hết hạn</span>;

              return (
                <tr key={p.id} style={{ cursor: 'pointer' }}
                  onClick={() => setDetail(p)}>
                  <td><span className="font-mono text-primary">{p.promo_code}</span></td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    {p.min_order_amount > 0 && (
                      <div style={{ fontSize: 12, color: '#888' }}>
                        Đơn tối thiểu: {fmt(p.min_order_amount)}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${PROMO_TYPE_COLOR[p.promo_type]}`}>
                      {PROMO_TYPE_LABEL[p.promo_type]}
                    </span>
                  </td>
                  <td>
                    {p.promo_type === 'percent' && (
                      <span style={{ fontWeight: 700, color: '#e53e3e' }}>
                        -{p.discount_percent}%
                        {p.max_discount_cap && (
                          <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>
                            {' '}(tối đa {fmt(p.max_discount_cap)})
                          </span>
                        )}
                      </span>
                    )}
                    {p.promo_type === 'fixed' && (
                      <span style={{ fontWeight: 700, color: '#e53e3e' }}>
                        -{fmt(p.discount_amount)}
                      </span>
                    )}
                    {(p.promo_type === 'gift' || p.promo_type === 'combo') && (
                      <span style={{ color: '#805ad5' }}>
                        🎁 {p.gift_items?.name ?? 'Quà tặng'} ×{p.gift_quantity}
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    <div>{fmtDate(p.valid_from)}</div>
                    <div style={{ color: '#888' }}>→ {fmtDate(p.valid_until)}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{p.usage_count}</span>
                    {p.usage_limit && (
                      <span style={{ color: '#888', fontSize: 12 }}>/{p.usage_limit}</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>{statusBadge}</td>
                  <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      <button className="btn btn-sm btn-outline" onClick={() => openEdit(p)}>✏️</button>
                      <button
                        className={`btn btn-sm ${p.is_active ? 'btn-warning' : 'btn-success'}`}
                        onClick={() => toggleMut.mutate(p.id)}
                        disabled={toggleMut.isPending}
                      >
                        {p.is_active ? '⏸' : '▶️'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phân trang */}
      {totalPages > 1 && (
        <div className="pagination" style={{ marginTop: 12 }}>
          <button className="btn btn-sm btn-outline" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>‹</button>
          <span style={{ padding: '0 12px', fontSize: 14 }}>Trang {page}/{totalPages}</span>
          <button className="btn btn-sm btn-outline" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>›</button>
        </div>
      )}

      {/* ══ MODAL TẠO / SỬA ══ */}
      {modalOpen && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {editData ? '✏️ Sửa chương trình' : '+ Tạo chương trình khuyến mãi'}
              </span>
              <button className="modal-close" onClick={closeModal}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 140px)' }}>

              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Tên */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Tên chương trình <span className="text-danger">*</span></label>
                  <input className="input" value={form.name} onChange={e => setF('name', e.target.value)}
                    placeholder="VD: Khuyến mãi tháng 6 — Giảm 5%" />
                </div>

                {/* Loại */}
                <div className="form-group">
                  <label className="form-label">Loại khuyến mãi</label>
                  <select className="input" value={form.promo_type}
                    onChange={e => setF('promo_type', e.target.value as PromoType)}>
                    <option value="percent">% Giảm giá</option>
                    <option value="fixed">Giảm tiền cố định</option>
                    <option value="gift">Tặng quà kèm</option>
                    <option value="combo">Combo ưu đãi</option>
                  </select>
                </div>

                {/* Mã KM */}
                <div className="form-group">
                  <label className="form-label">Mã KM <span style={{ color: '#888', fontWeight: 400 }}>(để trống = tự sinh)</span></label>
                  <input className="input" value={form.promo_code}
                    onChange={e => setF('promo_code', e.target.value.toUpperCase())}
                    placeholder="KM202601001" />
                </div>

                {/* Ưu đãi theo loại */}
                {form.promo_type === 'percent' && (<>
                  <div className="form-group">
                    <label className="form-label">Phần trăm giảm (%) <span className="text-danger">*</span></label>
                    <input className="input" type="number" min={1} max={100}
                      value={form.discount_percent}
                      onChange={e => setF('discount_percent', Number(e.target.value))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Trần giảm tối đa (₫)</label>
                    <input className="input" type="number" min={0}
                      value={form.max_discount_cap}
                      onChange={e => setF('max_discount_cap', e.target.value)}
                      placeholder="Để trống = không giới hạn" />
                  </div>
                </>)}

                {form.promo_type === 'fixed' && (
                  <div className="form-group" style={{ gridColumn: '1/-1' }}>
                    <label className="form-label">Số tiền giảm (₫) <span className="text-danger">*</span></label>
                    <input className="input" type="number" min={1}
                      value={form.discount_amount}
                      onChange={e => setF('discount_amount', Number(e.target.value))} />
                  </div>
                )}

                {(form.promo_type === 'gift' || form.promo_type === 'combo') && (<>
                  <div className="form-group">
                    <label className="form-label">Quà tặng kèm <span className="text-danger">*</span></label>
                    <select className="input" value={form.gift_item_id}
                      onChange={e => setF('gift_item_id', e.target.value)}>
                      <option value="">-- Chọn quà tặng --</option>
                      {giftItems.map((g: any) => (
                        <option key={g.id} value={g.id}>{g.name} (còn: {g.qty_in_stock})</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Số lượng quà</label>
                    <input className="input" type="number" min={1}
                      value={form.gift_quantity}
                      onChange={e => setF('gift_quantity', Number(e.target.value))} />
                  </div>
                  {form.promo_type === 'combo' && (
                    <div className="form-group" style={{ gridColumn: '1/-1' }}>
                      <label className="form-label">Số tiền giảm thêm (₫)</label>
                      <input className="input" type="number" min={0}
                        value={form.discount_amount}
                        onChange={e => setF('discount_amount', Number(e.target.value))}
                        placeholder="Để 0 nếu chỉ tặng quà" />
                    </div>
                  )}
                </>)}

                {/* Điều kiện */}
                <div className="form-group">
                  <label className="form-label">Đơn hàng tối thiểu (₫)</label>
                  <input className="input" type="number" min={0}
                    value={form.min_order_amount}
                    onChange={e => setF('min_order_amount', Number(e.target.value))} />
                </div>

                <div className="form-group">
                  <label className="form-label">Giới hạn lượt dùng</label>
                  <input className="input" type="number" min={1}
                    value={form.usage_limit}
                    onChange={e => setF('usage_limit', e.target.value)}
                    placeholder="Để trống = không giới hạn" />
                </div>

                {/* Hiệu lực */}
                <div className="form-group">
                  <label className="form-label">Ngày bắt đầu <span className="text-danger">*</span></label>
                  <input className="input" type="date" value={form.valid_from}
                    onChange={e => setF('valid_from', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Ngày kết thúc <span className="text-danger">*</span></label>
                  <input className="input" type="date" value={form.valid_until}
                    onChange={e => setF('valid_until', e.target.value)} />
                </div>

                {/* Hãng xe áp dụng */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Hãng xe áp dụng
                    <span style={{ color: '#888', fontWeight: 400 }}> (phân cách bằng dấu phẩy, để trống = tất cả)</span>
                  </label>
                  <input className="input" value={form.applicable_brands}
                    onChange={e => setF('applicable_brands', e.target.value)}
                    placeholder="VD: VinFast, Yamaha, Honda" />
                </div>

                {/* Mô tả */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Mô tả chương trình</label>
                  <textarea className="input" rows={2} value={form.description}
                    onChange={e => setF('description', e.target.value)}
                    placeholder="Mô tả ngắn hiển thị cho nhân viên bán hàng" />
                </div>

                {/* Ghi chú nội bộ */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Ghi chú nội bộ</label>
                  <textarea className="input" rows={2} value={form.note}
                    onChange={e => setF('form_note', e.target.value)}
                    placeholder="Điều kiện đặc biệt, nguồn ngân sách..." />
                </div>

                {/* Kích hoạt */}
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_active}
                      onChange={e => setF('is_active', e.target.checked)} />
                    <span>Kích hoạt ngay sau khi tạo</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={closeModal}>Hủy</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
                {isPending ? 'Đang lưu...' : editData ? 'Cập nhật' : 'Tạo chương trình'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CHI TIẾT ══ */}
      {detailItem && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                🎉 {detailItem.name}
                <span className="font-mono" style={{ fontSize: 13, marginLeft: 10, color: '#888' }}>
                  {detailItem.promo_code}
                </span>
              </span>
              <button className="modal-close" onClick={() => setDetail(null)}>×</button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', maxHeight: 'calc(90vh - 130px)' }}>

              {loadingDetail ? (
                <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
              ) : detailFull && (<>

                {/* Thông tin chính */}
                <div className="order-detail-grid" style={{ marginBottom: 16 }}>
                  <div className="order-detail-col">
                    <div className="order-detail-item">
                      <span className="order-detail-label">Loại</span>
                      <span className={`badge ${PROMO_TYPE_COLOR[detailFull.promo_type]}`}>
                        {PROMO_TYPE_LABEL[detailFull.promo_type]}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Ưu đãi</span>
                      <span className="order-detail-val" style={{ color: '#e53e3e', fontWeight: 700 }}>
                        {detailFull.promo_type === 'percent'
                          ? `-${detailFull.discount_percent}%${detailFull.max_discount_cap ? ` (tối đa ${fmt(detailFull.max_discount_cap)})` : ''}`
                          : detailFull.promo_type === 'fixed'
                          ? `-${fmt(detailFull.discount_amount)}`
                          : `🎁 ${detailFull.gift_items?.name ?? '—'} ×${detailFull.gift_quantity}`}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Đơn tối thiểu</span>
                      <span className="order-detail-val">{fmt(detailFull.min_order_amount)}</span>
                    </div>
                  </div>
                  <div className="order-detail-col">
                    <div className="order-detail-item">
                      <span className="order-detail-label">Hiệu lực</span>
                      <span className="order-detail-val">
                        {fmtDate(detailFull.valid_from)} → {fmtDate(detailFull.valid_until)}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Hãng áp dụng</span>
                      <span className="order-detail-val">
                        {detailFull.applicable_brands?.join(', ') || 'Tất cả'}
                      </span>
                    </div>
                    <div className="order-detail-item">
                      <span className="order-detail-label">Người tạo</span>
                      <span className="order-detail-val">{detailFull.users?.full_name ?? '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Thanh tiến độ */}
                {detailFull.usage_limit && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>Lượt đã dùng</span>
                      <span>{detailFull.usage_count} / {detailFull.usage_limit} ({progressPct}%)</span>
                    </div>
                    <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${progressPct}%`,
                        background: progressPct >= 90 ? '#e53e3e' : progressPct >= 70 ? '#ed8936' : '#48bb78',
                        borderRadius: 4, transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                )}

                {detailFull.description && (
                  <div style={{ background: '#f7fafc', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                    <p style={{ margin: 0, color: '#4a5568' }}>{detailFull.description}</p>
                  </div>
                )}

                {/* Lịch sử sử dụng */}
                <p className="form-section-title">📊 Lịch sử sử dụng ({usageHistory.length})</p>
                {usageHistory.length === 0 ? (
                  <p style={{ color: '#888', textAlign: 'center', padding: 20 }}>Chưa có lượt nào</p>
                ) : (
                  <table className="table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Đơn hàng</th>
                        <th>Khách hàng</th>
                        <th>Ngày áp dụng</th>
                        <th style={{ textAlign: 'right' }}>Chiết khấu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageHistory.map(u => (
                        <tr key={u.id}>
                          <td><span className="font-mono text-primary">{u.sales_orders?.order_number ?? '—'}</span></td>
                          <td>{u.customers?.full_name ?? '—'}</td>
                          <td>{fmtDate(u.created_at)}</td>
                          <td style={{ textAlign: 'right', color: '#e53e3e', fontWeight: 600 }}>
                            -{fmt(u.discount_applied)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>)}
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => { setDetail(null); openEdit(detailItem); }}>
                ✏️ Sửa
              </button>
              <button
                className={`btn ${detailItem.is_active ? 'btn-warning' : 'btn-success'}`}
                onClick={() => toggleMut.mutate(detailItem.id)}
                disabled={toggleMut.isPending}
              >
                {detailItem.is_active ? '⏸ Tắt chương trình' : '▶️ Kích hoạt'}
              </button>
              <button className="btn btn-outline" onClick={() => setDetail(null)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
