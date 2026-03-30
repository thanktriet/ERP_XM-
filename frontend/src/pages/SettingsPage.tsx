// Trang cấu hình phí & dịch vụ đăng ký xe
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { formatCurrency } from '../utils/helpers';
import type { FeeSetting, RegistrationService } from '../types';
import toast from 'react-hot-toast';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtInput = (v: number) => v.toLocaleString('vi-VN');
const parseAmt = (s: string) => parseInt(s.replace(/\D/g, '') || '0', 10);

// ─── Component ───────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const qc = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: feesData, isLoading: loadingFees } = useQuery<{ data: FeeSetting[] }>({
    queryKey: ['fee-settings'],
    queryFn:  () => api.get('/settings/fees?all=true').then(r => r.data),
    staleTime: 30_000,
  });

  const { data: svcData, isLoading: loadingSvc } = useQuery<{ data: RegistrationService[] }>({
    queryKey: ['reg-services'],
    queryFn:  () => api.get('/settings/services?all=true').then(r => r.data),
    staleTime: 30_000,
  });

  const fees     = feesData?.data ?? [];
  const services = svcData?.data  ?? [];

  // ── Mutations phí ──────────────────────────────────────────────────────────
  const updateFeeMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<FeeSetting> }) =>
      api.put(`/settings/fees/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-settings'] }); toast.success('Đã lưu'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi lưu phí'),
  });

  const createFeeMut = useMutation({
    mutationFn: (body: any) => api.post('/settings/fees', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-settings'] }); toast.success('Đã thêm phí'); setShowAddFee(false); resetFeeForm(); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi thêm phí'),
  });

  const deleteFeeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/fees/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fee-settings'] }); toast.success('Đã xóa'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi xóa'),
  });

  // ── Mutations dịch vụ ──────────────────────────────────────────────────────
  const updateSvcMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<RegistrationService> }) =>
      api.put(`/settings/services/${id}`, body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reg-services'] }); toast.success('Đã lưu'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi lưu dịch vụ'),
  });

  const createSvcMut = useMutation({
    mutationFn: (body: any) => api.post('/settings/services', body).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reg-services'] }); toast.success('Đã thêm dịch vụ'); setShowAddSvc(false); resetSvcForm(); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi thêm dịch vụ'),
  });

  const deleteSvcMut = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/services/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reg-services'] }); toast.success('Đã xóa'); },
    onError:   (e: any) => toast.error(e?.response?.data?.error ?? 'Lỗi xóa'),
  });

  // ── State inline-edit phí ──────────────────────────────────────────────────
  const [editFeeId,  setEditFeeId]  = useState<string | null>(null);
  const [editFeeVal, setEditFeeVal] = useState('');
  const [editFeeLbl, setEditFeeLbl] = useState('');
  const [editFeeNote, setEditFeeNote] = useState('');

  const startEditFee = (f: FeeSetting) => {
    setEditFeeId(f.id);
    setEditFeeVal(f.amount.toLocaleString('vi-VN'));
    setEditFeeLbl(f.label);
    setEditFeeNote(f.note ?? '');
  };
  const saveEditFee = (id: string) => {
    updateFeeMut.mutate({ id, body: { label: editFeeLbl, amount: parseAmt(editFeeVal), note: editFeeNote } });
    setEditFeeId(null);
  };

  // ── State inline-edit dịch vụ ─────────────────────────────────────────────
  const [editSvcId,   setEditSvcId]   = useState<string | null>(null);
  const [editSvcName, setEditSvcName] = useState('');
  const [editSvcDesc, setEditSvcDesc] = useState('');
  const [editSvcPrice,setEditSvcPrice]= useState('');

  const startEditSvc = (s: RegistrationService) => {
    setEditSvcId(s.id);
    setEditSvcName(s.name);
    setEditSvcDesc(s.description ?? '');
    setEditSvcPrice(s.price.toLocaleString('vi-VN'));
  };
  const saveEditSvc = (id: string) => {
    updateSvcMut.mutate({ id, body: { name: editSvcName, description: editSvcDesc, price: parseAmt(editSvcPrice) } });
    setEditSvcId(null);
  };

  // ── Form thêm mới ──────────────────────────────────────────────────────────
  const [showAddFee, setShowAddFee] = useState(false);
  const [newFeeKey,  setNewFeeKey]  = useState('');
  const [newFeeLbl,  setNewFeeLbl]  = useState('');
  const [newFeeAmt,  setNewFeeAmt]  = useState('');
  const [newFeeNote, setNewFeeNote] = useState('');
  const resetFeeForm = () => { setNewFeeKey(''); setNewFeeLbl(''); setNewFeeAmt(''); setNewFeeNote(''); };

  const [showAddSvc, setShowAddSvc] = useState(false);
  const [newSvcName, setNewSvcName] = useState('');
  const [newSvcDesc, setNewSvcDesc] = useState('');
  const [newSvcPrice,setNewSvcPrice]= useState('');
  const resetSvcForm = () => { setNewSvcName(''); setNewSvcDesc(''); setNewSvcPrice(''); };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '24px', maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Cấu hình phí & Dịch vụ</h1>

      {/* ══ BẢNG PHÍ CỐ ĐỊNH ══════════════════════════════════════════════════ */}
      <section style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Phí cố định</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddFee(v => !v)}>
            {showAddFee ? '✕ Đóng' : '+ Thêm phí'}
          </button>
        </div>

        {/* Form thêm phí */}
        {showAddFee && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lblStyle}>Key (nội bộ)</label>
                <input className="input" placeholder="vd: phi_bien_so_2" value={newFeeKey} onChange={e => setNewFeeKey(e.target.value)} />
              </div>
              <div>
                <label style={lblStyle}>Tên hiển thị</label>
                <input className="input" placeholder="vd: Phí biển số đặc biệt" value={newFeeLbl} onChange={e => setNewFeeLbl(e.target.value)} />
              </div>
              <div>
                <label style={lblStyle}>Số tiền (đ)</label>
                <input className="input" placeholder="0" value={newFeeAmt}
                  onChange={e => setNewFeeAmt(fmtInput(parseAmt(e.target.value)))} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lblStyle}>Ghi chú</label>
              <input className="input" placeholder="Ghi chú thêm..." value={newFeeNote} onChange={e => setNewFeeNote(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => {
                if (!newFeeKey || !newFeeLbl) return toast.error('Nhập key và tên');
                createFeeMut.mutate({ key: newFeeKey, label: newFeeLbl, amount: parseAmt(newFeeAmt), note: newFeeNote });
              }}>Lưu</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowAddFee(false); resetFeeForm(); }}>Hủy</button>
            </div>
          </div>
        )}

        {/* Bảng phí */}
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={thRow}>
                <th style={th}>Tên phí</th>
                <th style={{ ...th, textAlign: 'right' }}>Số tiền</th>
                <th style={th}>Ghi chú</th>
                <th style={{ ...th, textAlign: 'center' }}>Trạng thái</th>
                <th style={{ ...th, textAlign: 'center' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loadingFees ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Đang tải...</td></tr>
              ) : fees.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Chưa có phí nào</td></tr>
              ) : fees.map(f => (
                <tr key={f.id} style={tdRow}>
                  {editFeeId === f.id ? (
                    <>
                      <td style={td}>
                        <input className="input" style={{ marginBottom: 4 }} value={editFeeLbl}
                          onChange={e => setEditFeeLbl(e.target.value)} />
                        <input className="input" placeholder="Ghi chú" value={editFeeNote}
                          onChange={e => setEditFeeNote(e.target.value)} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input className="input" style={{ textAlign: 'right' }} value={editFeeVal}
                          onChange={e => setEditFeeVal(fmtInput(parseAmt(e.target.value)))} />
                      </td>
                      <td style={td} colSpan={2}></td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => saveEditFee(f.id)}>Lưu</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditFeeId(null)}>Hủy</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{f.label}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>{f.key}</div>
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#1e40af' }}>
                        {formatCurrency(f.amount)}
                      </td>
                      <td style={{ ...td, fontSize: 13, color: '#6b7280' }}>{f.note ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button
                          style={{
                            background: f.is_active ? '#d1fae5' : '#fee2e2',
                            color: f.is_active ? '#065f46' : '#991b1b',
                            border: 'none', borderRadius: 999, padding: '2px 12px',
                            fontSize: 12, cursor: 'pointer', fontWeight: 500,
                          }}
                          onClick={() => updateFeeMut.mutate({ id: f.id, body: { is_active: !f.is_active } })}
                        >
                          {f.is_active ? 'Đang dùng' : 'Tắt'}
                        </button>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => startEditFee(f)}>Sửa</button>
                          <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
                            onClick={() => { if (confirm(`Xóa "${f.label}"?`)) deleteFeeMut.mutate(f.id); }}>Xóa</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
          * Phí "Đang dùng" sẽ được tự động cộng vào tổng tiền trong POS. Tắt để ẩn khỏi POS.
        </p>
      </section>

      {/* ══ DỊCH VỤ ĐĂNG KÝ ══════════════════════════════════════════════════ */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Dịch vụ đăng ký xe</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddSvc(v => !v)}>
            {showAddSvc ? '✕ Đóng' : '+ Thêm dịch vụ'}
          </button>
        </div>

        {/* Form thêm dịch vụ */}
        {showAddSvc && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label style={lblStyle}>Tên dịch vụ</label>
                <input className="input" placeholder="vd: Đăng ký biển số tỉnh" value={newSvcName} onChange={e => setNewSvcName(e.target.value)} />
              </div>
              <div>
                <label style={lblStyle}>Giá dịch vụ (đ)</label>
                <input className="input" placeholder="0" value={newSvcPrice}
                  onChange={e => setNewSvcPrice(fmtInput(parseAmt(e.target.value)))} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={lblStyle}>Mô tả</label>
              <input className="input" placeholder="Mô tả ngắn về dịch vụ..." value={newSvcDesc} onChange={e => setNewSvcDesc(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => {
                if (!newSvcName) return toast.error('Nhập tên dịch vụ');
                createSvcMut.mutate({ name: newSvcName, description: newSvcDesc, price: parseAmt(newSvcPrice) });
              }}>Lưu</button>
              <button className="btn btn-secondary btn-sm" onClick={() => { setShowAddSvc(false); resetSvcForm(); }}>Hủy</button>
            </div>
          </div>
        )}

        {/* Bảng dịch vụ */}
        <div style={tableWrap}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={thRow}>
                <th style={th}>Tên dịch vụ</th>
                <th style={{ ...th, textAlign: 'right' }}>Giá</th>
                <th style={{ ...th, textAlign: 'center' }}>Trạng thái</th>
                <th style={{ ...th, textAlign: 'center' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loadingSvc ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Đang tải...</td></tr>
              ) : services.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#888' }}>Chưa có dịch vụ nào</td></tr>
              ) : services.map(s => (
                <tr key={s.id} style={tdRow}>
                  {editSvcId === s.id ? (
                    <>
                      <td style={td}>
                        <input className="input" style={{ marginBottom: 4 }} value={editSvcName} onChange={e => setEditSvcName(e.target.value)} />
                        <input className="input" placeholder="Mô tả" value={editSvcDesc} onChange={e => setEditSvcDesc(e.target.value)} />
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <input className="input" style={{ textAlign: 'right' }} value={editSvcPrice}
                          onChange={e => setEditSvcPrice(fmtInput(parseAmt(e.target.value)))} />
                      </td>
                      <td style={td}></td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => saveEditSvc(s.id)}>Lưu</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditSvcId(null)}>Hủy</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{s.name}</div>
                        {s.description && <div style={{ fontSize: 12, color: '#6b7280' }}>{s.description}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#1e40af' }}>
                        {formatCurrency(s.price)}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <button
                          style={{
                            background: s.is_active ? '#d1fae5' : '#fee2e2',
                            color: s.is_active ? '#065f46' : '#991b1b',
                            border: 'none', borderRadius: 999, padding: '2px 12px',
                            fontSize: 12, cursor: 'pointer', fontWeight: 500,
                          }}
                          onClick={() => updateSvcMut.mutate({ id: s.id, body: { is_active: !s.is_active } })}
                        >
                          {s.is_active ? 'Đang dùng' : 'Tắt'}
                        </button>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => startEditSvc(s)}>Sửa</button>
                          <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
                            onClick={() => { if (confirm(`Xóa "${s.name}"?`)) deleteSvcMut.mutate(s.id); }}>Xóa</button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
          * Dịch vụ "Đang dùng" sẽ hiện trong POS để nhân viên tích chọn khi tạo đơn.
        </p>
      </section>
    </div>
  );
}

// ─── Styles nội bộ ───────────────────────────────────────────────────────────
const tableWrap: React.CSSProperties = {
  border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden',
};
const thRow: React.CSSProperties = { background: '#f8fafc' };
const tdRow: React.CSSProperties = { borderTop: '1px solid #f1f5f9' };
const th: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: 12,
  fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td: React.CSSProperties = { padding: '10px 14px', fontSize: 14 };
const lblStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 };
