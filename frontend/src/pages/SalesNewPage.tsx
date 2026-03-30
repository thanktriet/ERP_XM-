// Trang tạo đơn bán hàng mới — giao diện POS hoàn chỉnh
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';

// ─── Type nội bộ POS: Promotion + trạng thái tick riêng ──────────────────────
type PromoInPOS = import('../types').Promotion & { _checked: boolean };
import { formatCurrency, getInitials } from '../utils/helpers';
import { useAuthStore } from '../store/authStore';
import type { Customer, VehicleModel, InventoryVehicle, Accessory, CartAccessory, Promotion, FeeSetting, RegistrationService } from '../types';
import toast from 'react-hot-toast';
import './SalesNewPage.css';

// ─── Types nội bộ ────────────────────────────────────────────────────────────

interface FormTraGop {
  ngan_hang: string;
  so_thang: number;
  lai_suat: number; // % / tháng
}

interface FormKhachMoi {
  full_name: string;
  phone: string;
  id_card: string;
  address: string;
}

// ─── Hằng số ─────────────────────────────────────────────────────────────────
const KHUYEN_MAI_MAC_DINH: PromoInPOS[] = [];

const NGAY_HIEN_TAI = new Date().toISOString().split('T')[0];

// Labels cho danh mục phụ kiện
const ACCESSORY_CATEGORY: Record<string, { label: string; icon: string }> = {
  safety:  { label: 'Bảo hộ',    icon: '' },
  luggage: { label: 'Hành lý',   icon: '' },
  comfort: { label: 'Tiện nghi', icon: '' },
  weather: { label: 'Thời tiết', icon: '' },
  decor:   { label: 'Trang trí', icon: '' },
  other:   { label: 'Khác',      icon: '' },
};

// ─── Component chính ─────────────────────────────────────────────────────────
export default function SalesNewPage() {
  const navigate  = useNavigate();
  const qc        = useQueryClient();
  const { user }  = useAuthStore();

  // Mã đơn tạm — ổn định, không random mỗi render
  const [previewCode] = useState(() => {
    const d = new Date();
    return `DH${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.floor(1000 + Math.random() * 9000)}`;
  });

  // ── Bước 1: Khách hàng ───────────────────────────────────────────────────
  const [searchKH, setSearchKH]               = useState('');
  const [showKHDrop, setShowKHDrop]           = useState(false);
  const [khachHang, setKhachHang]             = useState<Customer | null>(null);
  const [showModalKH, setShowModalKH]         = useState(false);
  const [formKhachMoi, setFormKhachMoi]       = useState<FormKhachMoi>({
    full_name: '', phone: '', id_card: '', address: '',
  });

  // ── Bước 2: Xe ───────────────────────────────────────────────────────────
  const [searchXe, setSearchXe]               = useState('');
  const [modelId, setModelId]                 = useState('');
  const [mauChon, setMauChon]                 = useState('');
  const [phienBanChon, setPhienBanChon]       = useState('');    // ten của variant
  const [vehicleChon, setVehicleChon]         = useState<InventoryVehicle | null>(null);
  const [, setShowVINDrop]                     = useState(false);

  // ── Bước 3: Thanh toán ───────────────────────────────────────────────────
  const [hinhThuc, setHinhThuc]               = useState<'tra_thang' | 'tra_gop'>('tra_thang');
  const [phuongThuc, setPhuongThuc]           = useState<'cash' | 'bank_transfer' | 'qr' | 'installment'>('cash');
  const [traGop, setTraGop]                   = useState<FormTraGop>({ ngan_hang: '', so_thang: 12, lai_suat: 1.2 });
  const [datCoc, setDatCoc]                   = useState('');
  const [tienKhach, setTienKhach]             = useState('');

  // ── Bước 4: Khuyến mãi ───────────────────────────────────────────────────
  const [khuyenMai, setKhuyenMai]             = useState<PromoInPOS[]>(KHUYEN_MAI_MAC_DINH);

  // ── Bước 2b: Phụ kiện bán kèm ─────────────────────────────────────────────
  const [gioPhKien, setGioPhKien]             = useState<CartAccessory[]>([]);
  const [filterCatPK, setFilterCatPK]         = useState<string>('');

  // ── Dịch vụ đăng ký (tick chọn) ──────────────────────────────────────────
  const [dichVuChon, setDichVuChon]           = useState<Set<string>>(new Set());

  // ── Bước 5: Ghi chú & giao hàng ─────────────────────────────────────────
  const [ghiChu, setGhiChu]                   = useState('');
  const [ngayGiao, setNgayGiao]               = useState('');
  const [diaChiGiao, setDiaChiGiao]           = useState('');
  const [fileHoSo, setFileHoSo]               = useState<File[]>([]);

  // Tự điền địa chỉ giao khi chọn KH
  useEffect(() => {
    if (khachHang?.address && !diaChiGiao) setDiaChiGiao(khachHang.address);
  }, [khachHang]);

  // ─── Queries ─────────────────────────────────────────────────────────────

  // Tìm kiếm khách hàng
  const { data: dsKH, isFetching: fetchingKH } = useQuery<{ data: Customer[] }>({
    queryKey: ['kh-search', searchKH],
    queryFn: () => api.get('/customers', { params: { search: searchKH, limit: 8 } }).then(r => r.data),
    enabled: searchKH.length >= 1,
    staleTime: 5000,
  });

  // Danh sách mẫu xe (active)
  const { data: dsModel, isLoading: loadingModel } = useQuery<{ data: VehicleModel[] }>({
    queryKey: ['vehicle-models-pos'],
    queryFn: () => api.get('/vehicles', { params: { limit: 100, is_active: true } }).then(r => r.data),
  });

  // Tất cả xe tồn kho của model đang chọn
  const { data: dsVehicleAll, isLoading: loadingVehicle } = useQuery<{ data: InventoryVehicle[] }>({
    queryKey: ['inventory-model', modelId],
    queryFn: () => api.get('/inventory', { params: { model_id: modelId, status: 'in_stock', limit: 200 } }).then(r => r.data),
    enabled: !!modelId,
  });

  // Danh sách phụ kiện tương thích với model đang chọn (hoặc tất cả nếu chưa chọn)
  const { data: dsPhKien, isLoading: loadingPK } = useQuery<{ data: Accessory[] }>({
    queryKey: ['accessories', modelId],
    queryFn: () =>
      api.get('/accessories', {
        params: { model_id: modelId || undefined, is_active: 'true' },
      }).then(r => r.data),
    staleTime: 60_000,
  });

  // Khuyến mãi đang hoạt động từ API
  const { data: dsActivePromos } = useQuery<{ data: import('../types').Promotion[] }>({
    queryKey: ['active-promos', modelId],
    queryFn: () =>
      api.get('/promotions/active', {
        params: { model_id: modelId || undefined },
      }).then(r => r.data),
    staleTime: 60_000,
  });

  // Phí cố định từ API (is_active = true)
  const { data: feesData } = useQuery<{ data: FeeSetting[] }>({
    queryKey: ['fee-settings-pos'],
    queryFn:  () => api.get('/settings/fees').then(r => r.data),
    staleTime: 300_000,
  });
  const dsFees = feesData?.data ?? [];
  const tongPhi = dsFees.reduce((s, f) => s + f.amount, 0);

  // Dịch vụ đăng ký từ API
  const { data: svcData } = useQuery<{ data: RegistrationService[] }>({
    queryKey: ['reg-services-pos'],
    queryFn:  () => api.get('/settings/services').then(r => r.data),
    staleTime: 300_000,
  });
  const dsDichVu = svcData?.data ?? [];
  const tongDichVu = dsDichVu
    .filter(s => dichVuChon.has(s.id))
    .reduce((s, sv) => s + sv.price, 0);

  // Cập nhật danh sách KM khi model thay đổi, giữ lại trạng thái _checked
  useEffect(() => {
    const incoming = dsActivePromos?.data ?? [];
    setKhuyenMai(prev => {
      const checkedIds = new Set(prev.filter(k => k._checked).map(k => k.id));
      // KM mới mặc định được tick; KM đã có giữ nguyên trạng thái
      return incoming.map(p => ({
        ...p,
        _checked: checkedIds.size > 0 ? checkedIds.has(p.id) : true,
      }));
    });
  }, [dsActivePromos]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const modelChon = useMemo(
    () => dsModel?.data?.find(m => m.id === modelId) ?? null,
    [dsModel, modelId],
  );

  // Danh sách màu có hàng thực tế
  const dauMauCoHang = useMemo(() => {
    if (!dsVehicleAll?.data) return [];
    const mauSet = new Set(dsVehicleAll.data.map(v => v.color).filter(Boolean));
    return [...mauSet];
  }, [dsVehicleAll]);

  // Xe theo màu đã chọn
  const dsXeTheoMau = useMemo(
    () => (dsVehicleAll?.data ?? []).filter(v => v.color === mauChon),
    [dsVehicleAll, mauChon],
  );

  const soLuongConHang = dsXeTheoMau.length;

  // Lọc model theo search
  const dsModelHienThi = useMemo(
    () => (dsModel?.data ?? []).filter(m => !searchXe || m.model_name.toLowerCase().includes(searchXe.toLowerCase())),
    [dsModel, searchXe],
  );

  // ─── Tính tiền ────────────────────────────────────────────────────────────
  const variantChon  = modelChon?.variants?.find(v => v.ten === phienBanChon);
  const giaNiemYet   = (modelChon?.price_sell ?? 0) + (variantChon?.gia_chen_them ?? 0);

  const tongGiamGia = useMemo(() => {
    return -khuyenMai
      .filter(k => k._checked && (k.promo_type === 'percent' || k.promo_type === 'fixed'))
      .reduce((s, k) => {
        if (k.promo_type === 'percent') {
          const giam = giaNiemYet * k.discount_percent / 100;
          return s + (k.max_discount_cap ? Math.min(giam, k.max_discount_cap) : giam);
        }
        return s + k.discount_amount;
      }, 0);
  }, [khuyenMai, giaNiemYet]);

  const tongPhKien = useMemo(
    () => gioPhKien.reduce((sum, item) => sum + item.line_total, 0),
    [gioPhKien],
  );

  const tongThanhToan = Math.max(0, giaNiemYet + tongGiamGia + tongPhi + tongPhKien + tongDichVu);

  const datCocNum    = parseInt(datCoc.replace(/\D/g, '') || '0', 10);
  const conLaiNum    = Math.max(0, tongThanhToan - datCocNum);
  const tienKhachNum = parseInt(tienKhach.replace(/\D/g, '') || '0', 10);
  const tienThoiNum  = Math.max(0, tienKhachNum - conLaiNum);

  // Tổng tiền trả góp / tháng
  const tienTraGopThang = useMemo(() => {
    if (hinhThuc !== 'tra_gop' || traGop.so_thang === 0) return 0;
    const goc = conLaiNum;
    const lai = goc * (traGop.lai_suat / 100) * traGop.so_thang;
    return Math.round((goc + lai) / traGop.so_thang);
  }, [hinhThuc, traGop, conLaiNum]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  // Tạo KH mới
  const taoKHMut = useMutation({
    mutationFn: (body: FormKhachMoi) => api.post('/customers', body).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`Đã tạo khách hàng ${data.full_name}`);
      setKhachHang(data);
      setSearchKH(data.full_name);
      setShowModalKH(false);
      setFormKhachMoi({ full_name: '', phone: '', id_card: '', address: '' });
      qc.invalidateQueries({ queryKey: ['kh-search'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Lỗi tạo khách hàng'),
  });

  // Tạo đơn hàng
  const taodonMut = useMutation({
    mutationFn: (payload: any) => api.post('/sales', payload).then(r => r.data),
    onSuccess: (data) => {
      toast.success(`✅ Tạo đơn hàng ${data.order?.order_number ?? ''} thành công!`);
      navigate('/sales');
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || e?.response?.data?.details?.[0]?.msg || 'Lỗi tạo đơn hàng';
      toast.error(msg);
    },
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const mapPaymentMethod = (pt: typeof phuongThuc): string => {
    if (pt === 'qr') return 'bank_transfer';
    if (hinhThuc === 'tra_gop') return 'installment';
    return pt;
  };

  const buildNotes = (): string => {
    const parts: string[] = [];
    if (ghiChu) parts.push(ghiChu);
    if (hinhThuc === 'tra_gop') {
      parts.push(`Trả góp: ${traGop.ngan_hang} - ${traGop.so_thang} tháng - ${traGop.lai_suat}%/tháng - ${formatCurrency(tienTraGopThang)}/tháng`);
    }
    return parts.join('\n');
  };

  // ─── Handlers ─────────────────────────────────────────────────────────────

  // Thêm phụ kiện vào giỏ (click lần đầu = thêm, click lại = tăng SL)
  const addPhKien = useCallback((pk: Accessory) => {
    setGioPhKien(prev => {
      const idx = prev.findIndex(i => i.accessory.id === pk.id);
      if (idx >= 0) {
        return prev.map((i, n) =>
          n === idx
            ? { ...i, quantity: i.quantity + 1, line_total: (i.quantity + 1) * i.unit_price }
            : i
        );
      }
      return [...prev, { accessory: pk, quantity: 1, unit_price: pk.price_sell, line_total: pk.price_sell }];
    });
    toast.success(`Đã thêm: ${pk.name}`, { duration: 1500, icon: '🎁' });
  }, []);

  // Thay đổi số lượng phụ kiện (delta = +1 hoặc -1, SL = 0 → xóa)
  const changeQtyPhKien = useCallback((accessoryId: string, delta: number) => {
    setGioPhKien(prev =>
      prev
        .map(i => {
          if (i.accessory.id !== accessoryId) return i;
          const newQty = Math.max(0, i.quantity + delta);
          return { ...i, quantity: newQty, line_total: newQty * i.unit_price };
        })
        .filter(i => i.quantity > 0)
    );
  }, []);

  // Xóa phụ kiện khỏi giỏ
  const removePhKien = useCallback((accessoryId: string) => {
    setGioPhKien(prev => prev.filter(i => i.accessory.id !== accessoryId));
  }, []);

  const chonKhachHang = useCallback((kh: Customer) => {
    setKhachHang(kh);
    setSearchKH(kh.full_name);
    setShowKHDrop(false);
  }, []);

  const chonModel = useCallback((m: VehicleModel) => {
    setModelId(m.id);
    setMauChon('');
    setPhienBanChon('');
    setVehicleChon(null);
  }, []);

  const chonMau = useCallback((mau: string) => {
    setMauChon(mau);
    setVehicleChon(null);
    setShowVINDrop(false);
    // Tự động chọn xe đầu tiên của màu đó
  }, []);

  const chonVehicle = useCallback((v: InventoryVehicle) => {
    setVehicleChon(v);
    setShowVINDrop(false);
  }, []);

  const toggleKM = useCallback((id: string) => {
    setKhuyenMai(prev => prev.map(k => k.id === id ? { ...k, _checked: !k._checked } : k));
  }, []);

  const validate = (): boolean => {
    if (!khachHang)   { toast.error('Vui lòng chọn khách hàng');      return false; }
    if (!modelChon)   { toast.error('Vui lòng chọn mẫu xe');          return false; }
    if (!mauChon)     { toast.error('Vui lòng chọn màu xe');           return false; }
    if (soLuongConHang === 0) { toast.error('Màu này đã hết hàng trong kho'); return false; }
    if (!vehicleChon && dsXeTheoMau.length > 0) {
      // Tự chọn xe đầu tiên nếu chưa chọn cụ thể
      setVehicleChon(dsXeTheoMau[0]);
    }
    if (hinhThuc === 'tra_gop' && !traGop.ngan_hang.trim()) {
      toast.error('Nhập tên ngân hàng trả góp'); return false;
    }
    return true;
  };

  const buildPayload = () => {
    const xe = vehicleChon ?? dsXeTheoMau[0];
    return {
      customer_id:      khachHang!.id,
      salesperson_id:   user?.id,
      payment_method:   mapPaymentMethod(phuongThuc),
      discount_amount:  Math.abs(tongGiamGia),
      deposit_amount:   datCocNum,
      delivery_date:    ngayGiao || undefined,
      delivery_address: diaChiGiao || khachHang?.address || undefined,
      notes:            buildNotes() || undefined,
      items: [{
        vehicle_model_id:     modelChon!.id,
        inventory_vehicle_id: xe?.id,
        quantity:             1,
        unit_price:           giaNiemYet,
        discount_percent:     giaNiemYet > 0 ? Math.abs(tongGiamGia / giaNiemYet * 100) : 0,
        line_total:           Math.max(0, giaNiemYet + tongGiamGia),
      }],
      // Phụ kiện đi kèm
      accessories: gioPhKien.map(i => ({
        accessory_id: i.accessory.id,
        quantity:     i.quantity,
        unit_price:   i.unit_price,
      })),
      // Khuyến mãi được chọn
      promotions: khuyenMai
        .filter(k => k._checked)
        .map(k => ({
          promotion_id:    k.id,
          promo_name:      k.name,
          promo_type:      k.promo_type,
          discount_amount: k.promo_type === 'percent'
            ? giaNiemYet * k.discount_percent / 100
            : k.promo_type === 'fixed' ? k.discount_amount : 0,
          gift_item_id:   k.gift_items?.id   ?? null,
          gift_item_name: k.gift_items?.name ?? null,
          gift_quantity:  k.gift_quantity ?? 0,
        })),
      // Phí cố định đang bật
      fees: dsFees.map(f => ({
        fee_key:   f.key,
        fee_label: f.label,
        amount:    f.amount,
      })),
      // Dịch vụ đăng ký đã chọn
      services: dsDichVu
        .filter(s => dichVuChon.has(s.id))
        .map(s => ({
          service_id:   s.id,
          service_name: s.name,
          price:        s.price,
        })),
    };
  };

  const handleXacNhan = () => {
    if (!validate()) return;
    taodonMut.mutate(buildPayload());
  };

  const handleLuuTam = () => {
    // Lưu vào localStorage nếu chưa đủ dữ liệu gọi API
    if (!khachHang || !modelChon) {
      const draft = { khachHang, modelId, mauChon, ghiChu, datCoc, ngayGiao, diaChiGiao, khuyenMai };
      localStorage.setItem('pos_draft', JSON.stringify(draft));
      toast.success('Đã lưu nháp vào bộ nhớ tạm');
      return;
    }
    // Đủ data → gọi API với status draft (backend mặc định 'confirmed', ta override)
    const payload = { ...buildPayload() };
    api.post('/sales', payload)
      .then(r => {
        toast.success(`💾 Đã lưu nháp đơn ${r.data?.order?.order_number ?? ''}`);
        navigate('/sales');
      })
      .catch(() => {
        // Fallback localStorage
        localStorage.setItem('pos_draft', JSON.stringify({ khachHang, modelId, mauChon, ghiChu }));
        toast.success('Đã lưu nháp vào bộ nhớ tạm');
      });
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="pos-wrapper">

      {/* ════ TOPBAR ════ */}
      <div className="pos-topbar">
        <div className="pos-topbar-left">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/sales')}>← Bán Hàng</button>
          <span className="pos-topbar-sep">›</span>
          <span className="pos-topbar-sub">Tạo đơn bán mới</span>
        </div>
        <div className="pos-topbar-center">
          <span className="pos-ma-don">Mã đơn: <b>{previewCode}</b> <span className="pos-ma-tam">(tạm)</span></span>
          <span className="pos-ngay-gio">
            📅 {new Date().toLocaleDateString('vi-VN')} &nbsp;
            {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="pos-topbar-right">
          <div className="pos-user-badge">
            <span className="pos-user-avatar">{getInitials(user?.full_name ?? 'NV')}</span>
            <div>
              <div className="pos-user-name">{user?.full_name ?? 'Nhân viên'}</div>
              <div className="pos-user-role">{user?.role ?? ''}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ════ CONTENT 3 CỘT ════ */}
      <div className="pos-content">

        {/* ══════ CỘT 1 ══════ */}
        <div className="pos-col">

          {/* ── Card 1: Khách hàng ── */}
          <div className="pos-card">
            <div className="pos-card-header">
              <span className="pos-step-badge">1</span>
              <span className="pos-card-title">Thông Tin Khách Hàng</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowModalKH(true)}>+ Thêm mới</button>
            </div>
            <div className="pos-card-body">

              {/* Tìm kiếm KH */}
              <div className="pos-field">
                <label className="pos-label">Khách hàng <span className="pos-required">*</span></label>
                <div className="pos-input-wrap">
                  <input
                    className={`pos-input${khachHang ? ' pos-input-selected' : ''}`}
                    placeholder="Tìm theo tên hoặc SĐT..."
                    value={searchKH}
                    onChange={e => { setSearchKH(e.target.value); setShowKHDrop(true); if (!e.target.value) setKhachHang(null); }}
                    onFocus={() => searchKH && setShowKHDrop(true)}
                    onBlur={() => setTimeout(() => setShowKHDrop(false), 180)}
                  />
                  <span className="pos-input-icon">
                    {fetchingKH ? <span className="pos-spin" /> : '🔍'}
                  </span>
                  {showKHDrop && (dsKH?.data?.length ?? 0) > 0 && (
                    <div className="pos-dropdown">
                      {dsKH!.data.map(kh => (
                        <div key={kh.id} className="pos-dropdown-item" onMouseDown={() => chonKhachHang(kh)}>
                          <div className="pos-dropdown-name">{kh.full_name}</div>
                          <div className="pos-dropdown-sub">{kh.phone} · {kh.customer_code}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Thông tin KH đã chọn */}
              {khachHang ? (
                <div className="pos-kh-card">
                  <div className="pos-kh-avatar">{getInitials(khachHang.full_name)}</div>
                  <div className="pos-kh-info">
                    <div className="pos-kh-name">{khachHang.full_name}</div>
                    <div className="pos-kh-meta">📞 {khachHang.phone}</div>
                    {khachHang.address && <div className="pos-kh-meta">📍 {khachHang.address}</div>}
                  </div>
                  <button className="pos-kh-clear" onClick={() => { setKhachHang(null); setSearchKH(''); }} title="Xoá chọn">×</button>
                </div>
              ) : (
                <>
                  <div className="pos-field">
                    <label className="pos-label">Số điện thoại</label>
                    <div className="pos-input-wrap"><input className="pos-input" placeholder="0987 123 456" readOnly /><span className="pos-input-icon">📞</span></div>
                  </div>
                  <div className="pos-field">
                    <label className="pos-label">CCCD/CMND</label>
                    <div className="pos-input-wrap"><input className="pos-input" placeholder="079123456789" readOnly /><span className="pos-input-icon">🪪</span></div>
                  </div>
                  <div className="pos-field">
                    <label className="pos-label">Địa chỉ</label>
                    <div className="pos-input-wrap"><input className="pos-input" placeholder="Địa chỉ khách hàng" readOnly /><span className="pos-input-icon">📍</span></div>
                  </div>
                </>
              )}

              {/* Điểm tích lũy */}
              <div className={`pos-loyalty-box${khachHang ? ' has-data' : ''}`}>
                <span>🏆</span>
                <span>{khachHang ? `Điểm tích lũy: ${khachHang.loyalty_points} điểm` : 'Chưa chọn khách hàng'}</span>
              </div>
            </div>
          </div>

          {/* ── Card 4: Khuyến mãi ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">4</span>
              <span className="pos-card-title">Khuyến Mãi &amp; Quà Tặng</span>
              {khuyenMai.length > 0 && (
                <span className="badge badge-blue" style={{ fontSize: 11 }}>
                  {khuyenMai.filter(k => k._checked).length}/{khuyenMai.length} đã chọn
                </span>
              )}
            </div>
            <div className="pos-card-body">

              {khuyenMai.length === 0 ? (
                <div className="pos-km-empty">
                  {modelChon
                    ? 'Không có chương trình khuyến mãi phù hợp'
                    : 'Chọn mẫu xe để xem khuyến mãi áp dụng'}
                </div>
              ) : (<>
                <div className="pos-km-header-row">
                  <span style={{ flex: 1 }}>Tên chương trình</span>
                  <span style={{ width: 90 }}>Loại</span>
                  <span style={{ width: 120, textAlign: 'right' }}>Ưu đãi</span>
                </div>
                {khuyenMai.map(km => (
                  <div key={km.id} className={`pos-km-row${km._checked ? ' checked' : ''}`}>
                    <input type="checkbox" className="pos-km-check"
                      checked={km._checked} onChange={() => toggleKM(km.id)} />
                    <span className="pos-km-ten">
                      {km.name}
                      {km.min_order_amount > 0 && (
                        <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>
                          (đơn ≥ {km.min_order_amount.toLocaleString('vi-VN')} ₫)
                        </span>
                      )}
                    </span>
                    <span className={`badge pos-km-loai ${
                      km.promo_type === 'percent' ? 'badge-blue'
                      : km.promo_type === 'fixed'   ? 'badge-green'
                      : 'badge-purple'
                    }`}>
                      {km.promo_type === 'percent' ? 'Giảm %'
                        : km.promo_type === 'fixed' ? 'Giảm tiền'
                        : km.promo_type === 'gift'  ? 'Quà tặng'
                        : 'Combo'}
                    </span>
                    <span className="pos-km-gia text-danger">
                      {km.promo_type === 'percent'
                        ? `-${km.discount_percent}%`
                        : km.promo_type === 'fixed'
                        ? `-${km.discount_amount.toLocaleString('vi-VN')} ₫`
                        : `🎁 ${km.gift_items?.name ?? 'Quà tặng'}`}
                    </span>
                  </div>
                ))}

                {/* ── Danh sách quà tặng từ KM gift/combo đang chọn ── */}
                {(() => {
                  const dsQua = khuyenMai.filter(
                    k => k._checked && (k.promo_type === 'gift' || k.promo_type === 'combo') && k.gift_items,
                  );
                  if (!dsQua.length) return null;
                  return (
                    <div style={{ marginTop: 10, borderTop: '1px dashed #e2e8f0', paddingTop: 8 }}>
                      <div style={{ fontSize: 12, color: '#718096', marginBottom: 6, fontWeight: 600 }}>
                        🎁 Quà tặng kèm theo chương trình:
                      </div>
                      {dsQua.map(km => (
                        <div key={km.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 0', fontSize: 13,
                        }}>
                          <span style={{ color: '#805ad5', fontSize: 16 }}>🎁</span>
                          <span style={{ flex: 1 }}>{km.gift_items!.name}</span>
                          <span style={{
                            background: '#f3e8ff', color: '#6b21a8',
                            borderRadius: 6, padding: '1px 8px', fontSize: 12,
                          }}>
                            ×{km.gift_quantity} {km.gift_items?.category ? `(${km.gift_items.category})` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </>)}
            </div>
          </div>
        </div>

        {/* ══════ CỘT 2 ══════ */}
        <div className="pos-col">

          {/* ── Card 2: Chọn xe ── */}
          <div className="pos-card pos-card-tall">
            <div className="pos-card-header">
              <span className="pos-step-badge">2</span>
              <span className="pos-card-title">Chọn Xe &amp; Phiên Bản</span>
              <div className="pos-input-wrap" style={{ width: 190 }}>
                <input className="pos-input pos-input-sm" placeholder="Tìm kiếm xe..." value={searchXe} onChange={e => setSearchXe(e.target.value)} />
                <span className="pos-input-icon">🔍</span>
              </div>
            </div>
            <div className="pos-xe-layout">

              {/* Danh sách model */}
              <div className="pos-xe-list">
                <div className="pos-xe-list-title">Dòng xe</div>
                {loadingModel ? (
                  <div className="pos-xe-skeleton"><div className="pos-skel" /><div className="pos-skel" /><div className="pos-skel" /></div>
                ) : dsModelHienThi.length === 0 ? (
                  <div className="pos-xe-empty">Không tìm thấy</div>
                ) : dsModelHienThi.map(m => (
                  <button
                    key={m.id}
                    className={`pos-xe-item${modelId === m.id ? ' active' : ''}`}
                    onClick={() => chonModel(m)}
                  >
                    <span className="pos-xe-icon">🛵</span>
                    <span className="pos-xe-name">{m.model_name}</span>
                  </button>
                ))}
              </div>

              {/* Detail xe */}
              <div className="pos-xe-detail">
                {!modelChon ? (
                  <div className="pos-xe-placeholder"><span>🏍️</span><span>Chọn dòng xe bên trái</span></div>
                ) : (
                  <>
                    {/* Header */}
                    <div className="pos-xe-detail-header">
                      <span className="pos-xe-detail-title">Thông tin xe</span>
                      <span className={`badge ${soLuongConHang > 0 ? 'badge-green' : 'badge-red'}`}>
                        {loadingVehicle ? '...' : `Còn hàng: ${soLuongConHang}`}
                      </span>
                    </div>

                    {/* Ảnh */}
                    <div className="pos-xe-img-wrap">
                      {modelChon.image_url
                        ? <img src={modelChon.image_url} alt={modelChon.model_name} className="pos-xe-img" />
                        : <span className="pos-xe-img-ph">🛵</span>
                      }
                    </div>

                    <div className="pos-xe-detail-name">{modelChon.brand} {modelChon.model_name}</div>
                    <div className="pos-xe-detail-price">{formatCurrency(modelChon.price_sell)}</div>

                    {/* Màu sắc thực tế từ kho */}
                    <div className="pos-mau-label">Màu sắc (có sẵn trong kho)</div>
                    {loadingVehicle ? (
                      <div className="pos-mau-loading">Đang tải màu sắc...</div>
                    ) : dauMauCoHang.length === 0 ? (
                      <div className="pos-mau-empty">Hết hàng tất cả màu</div>
                    ) : (
                      <div className="pos-mau-row">
                        {dauMauCoHang.map(mau => {
                          const soLuong = (dsVehicleAll?.data ?? []).filter(v => v.color === mau).length;
                          return (
                            <button
                              key={mau}
                              className={`pos-mau-btn${mauChon === mau ? ' active' : ''}`}
                              style={{ '--mau-color': mauToMa(mau) } as any}
                              onClick={() => chonMau(mau)}
                              title={`${mau} (${soLuong} xe)`}
                            >
                              <span className="pos-mau-dot" />
                              {mauChon === mau && <span className="pos-mau-check">✓</span>}
                            </button>
                          );
                        })}
                        <span className="pos-mau-ten">{mauChon || 'Chọn màu'}</span>
                        {mauChon && (
                          <span className="pos-mau-count">
                            ({dsXeTheoMau.length} xe)
                          </span>
                        )}
                      </div>
                    )}

                    {/* Chọn phiên bản (variant) — chỉ hiện khi model có variants */}
                    {(modelChon?.variants?.length ?? 0) > 0 && (
                      <div className="pos-field" style={{ marginTop: 10 }}>
                        <label className="pos-label">Phiên bản</label>
                        <div className="pos-variant-row">
                          {/* Nút "Tiêu chuẩn" (không chênh lệch giá) */}
                          <button
                            type="button"
                            className={`pos-variant-btn${phienBanChon === '' ? ' active' : ''}`}
                            onClick={() => setPhienBanChon('')}
                          >
                            <span className="pos-variant-ten">Tiêu chuẩn</span>
                            <span className="pos-variant-gia">{formatCurrency(modelChon!.price_sell)}</span>
                          </button>
                          {modelChon!.variants!.map(v => (
                            <button
                              type="button"
                              key={v.ten}
                              className={`pos-variant-btn${phienBanChon === v.ten ? ' active' : ''}`}
                              onClick={() => setPhienBanChon(v.ten)}
                            >
                              <span className="pos-variant-ten">{v.ten}</span>
                              <span className="pos-variant-gia">
                                {formatCurrency(modelChon!.price_sell + v.gia_chen_them)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Chọn VIN cụ thể */}
                    {mauChon && dsXeTheoMau.length > 0 && (
                      <div className="pos-field" style={{ marginTop: 10 }}>
                        <label className="pos-label">Chọn xe cụ thể (VIN)</label>
                        <div className="pos-input-wrap">
                          <select
                            className="pos-input"
                            value={vehicleChon?.id ?? ''}
                            onChange={e => {
                              const xe = dsXeTheoMau.find(v => v.id === e.target.value);
                              if (xe) chonVehicle(xe);
                            }}
                          >
                            <option value="">— Tự động chọn xe đầu tiên —</option>
                            {dsXeTheoMau.map(v => (
                              <option key={v.id} value={v.id}>
                                {v.vin} {v.engine_number ? `· ${v.engine_number}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {/* Số khung / số máy */}
                    {(vehicleChon ?? dsXeTheoMau[0]) && (
                      <div className="pos-vin-row">
                        <div className="pos-vin-group">
                          <label className="pos-label">Số khung (VIN)</label>
                          <div className="pos-vin-box pos-vin-ok-box">
                            <span className="pos-vin-status">✓ Hợp lệ · Còn hàng</span>
                            <span className="pos-vin-val">{(vehicleChon ?? dsXeTheoMau[0])?.vin}</span>
                          </div>
                        </div>
                        <div className="pos-vin-group">
                          <label className="pos-label">Số máy</label>
                          <div className="pos-vin-box">
                            <span className="pos-vin-val pos-vin-gray">
                              {(vehicleChon ?? dsXeTheoMau[0])?.engine_number ?? '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Card Dịch vụ đăng ký ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">5</span>
              <span className="pos-card-title">Dịch Vụ Đăng Ký</span>
              {dichVuChon.size > 0 && (
                <span className="badge badge-blue" style={{ fontSize: 11 }}>
                  {dichVuChon.size} đã chọn · +{formatCurrency(tongDichVu)}
                </span>
              )}
            </div>
            <div className="pos-card-body">
              {dsDichVu.length === 0 ? (
                <div className="pos-km-empty">Chưa có dịch vụ nào — thêm tại trang Cấu hình</div>
              ) : dsDichVu.map(sv => {
                const checked = dichVuChon.has(sv.id);
                return (
                  <div key={sv.id} className={`pos-km-row${checked ? ' checked' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setDichVuChon(prev => {
                      const next = new Set(prev);
                      next.has(sv.id) ? next.delete(sv.id) : next.add(sv.id);
                      return next;
                    })}
                  >
                    <input type="checkbox" className="pos-km-check" readOnly checked={checked} />
                    <span className="pos-km-ten">
                      {sv.name}
                      {sv.description && (
                        <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>— {sv.description}</span>
                      )}
                    </span>
                    <span className="pos-km-gia" style={{ color: '#6366f1', minWidth: 90, textAlign: 'right' }}>
                      +{formatCurrency(sv.price)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Card 2b: Phụ Kiện Bán Kèm ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge pos-step-badge-pk">🎁</span>
              <span className="pos-card-title">Phụ Kiện Bán Kèm</span>
              {gioPhKien.length > 0 && (
                <span className="pos-pk-header-badge">{gioPhKien.length} loại</span>
              )}
            </div>
            <div className="pos-card-body">

              {/* Chưa chọn xe */}
              {!modelChon ? (
                <div className="pos-pk-hint">← Chọn dòng xe để xem phụ kiện tương thích</div>
              ) : loadingPK ? (
                <div className="pos-pk-loading"><span className="pos-spin" /> Đang tải phụ kiện...</div>
              ) : (dsPhKien?.data?.length ?? 0) === 0 ? (
                <div className="pos-pk-hint">Không có phụ kiện nào</div>
              ) : (
                <>
                  {/* Lọc theo danh mục */}
                  <div className="pos-pk-cats">
                    <button
                      className={`pos-pk-cat-btn${filterCatPK === '' ? ' active' : ''}`}
                      onClick={() => setFilterCatPK('')}
                    >Tất cả</button>
                    {[...new Set(dsPhKien!.data.map(p => p.category))].map(cat => (
                      <button
                        key={cat}
                        className={`pos-pk-cat-btn${filterCatPK === cat ? ' active' : ''}`}
                        onClick={() => setFilterCatPK(prev => prev === cat ? '' : cat)}
                      >
                        {ACCESSORY_CATEGORY[cat]?.label ?? cat}
                      </button>
                    ))}
                  </div>

                  {/* Grid catalog */}
                  <div className="pos-pk-grid">
                    {dsPhKien!.data
                      .filter(p => !filterCatPK || p.category === filterCatPK)
                      .map(pk => {
                        const inCart = gioPhKien.find(i => i.accessory.id === pk.id);
                        return (
                          <button
                            key={pk.id}
                            className={`pos-pk-item${inCart ? ' pos-pk-item-selected' : ''}`}
                            onClick={() => addPhKien(pk)}
                            title={pk.description ?? pk.name}
                          >
                            <div className="pos-pk-img">
                              {pk.image_url
                                ? <img src={pk.image_url} alt={pk.name} />
                                : <span className="pos-pk-icon-ph">
                                    {ACCESSORY_CATEGORY[pk.category]?.icon ?? '📦'}
                                  </span>
                              }
                              {inCart && (
                                <span className="pos-pk-qty-bubble">{inCart.quantity}</span>
                              )}
                            </div>
                            <div className="pos-pk-info">
                              <span className="pos-pk-name">{pk.name}</span>
                              <span className="pos-pk-price">{formatCurrency(pk.price_sell)}</span>
                              <span className="pos-pk-unit">/{pk.unit}</span>
                              {!pk.compatible_models?.length && (
                                <span style={{ fontSize: 10, color: '#059669', marginTop: 2 }}>Tất cả xe</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>

                  {/* Giỏ phụ kiện đã chọn */}
                  {gioPhKien.length > 0 && (
                    <div className="pos-pk-cart">
                      <div className="pos-pk-cart-header">Đã chọn</div>
                      {gioPhKien.map(item => (
                        <div key={item.accessory.id} className="pos-pk-cart-row">
                          <span className="pos-pk-cart-icon">
                            {ACCESSORY_CATEGORY[item.accessory.category]?.icon ?? '📦'}
                          </span>
                          <span className="pos-pk-cart-name">{item.accessory.name}</span>
                          <div className="pos-pk-qty-ctrl">
                            <button onClick={() => changeQtyPhKien(item.accessory.id, -1)}>−</button>
                            <span>{item.quantity}</span>
                            <button onClick={() => changeQtyPhKien(item.accessory.id, +1)}>+</button>
                          </div>
                          <span className="pos-pk-cart-total">{formatCurrency(item.line_total)}</span>
                          <button className="pos-pk-cart-del" onClick={() => removePhKien(item.accessory.id)}>×</button>
                        </div>
                      ))}
                      <div className="pos-pk-cart-sum">
                        <span>Tổng phụ kiện</span>
                        <span>{formatCurrency(tongPhKien)}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── Card 5: Ghi chú & Giao hàng ── */}
          <div className="pos-card pos-card-mt">
            <div className="pos-card-header">
              <span className="pos-step-badge">5</span>
              <span className="pos-card-title">Ghi Chú &amp; Thông Tin Giao Xe</span>
            </div>
            <div className="pos-ghichu-layout">
              <div>
                <div className="pos-field">
                  <label className="pos-label">Ghi chú đơn hàng</label>
                  <textarea
                    className="pos-input pos-textarea"
                    placeholder="Ghi chú thêm cho đơn hàng..."
                    value={ghiChu}
                    onChange={e => setGhiChu(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="pos-field">
                  <label className="pos-label">Hồ sơ đính kèm</label>
                  <label className="pos-upload-area">
                    <input type="file" multiple style={{ display: 'none' }} onChange={e => setFileHoSo(prev => [...prev, ...Array.from(e.target.files ?? [])])} />
                    <span>📎</span>
                    <span>{fileHoSo.length > 0 ? `${fileHoSo.length} tệp đã chọn` : 'Click để chọn file'}</span>
                  </label>
                </div>
              </div>
              <div>
                <div className="pos-field">
                  <label className="pos-label">Ngày giao xe dự kiến</label>
                  <input className="pos-input" type="date" value={ngayGiao} min={NGAY_HIEN_TAI} onChange={e => setNgayGiao(e.target.value)} />
                </div>
                <div className="pos-field">
                  <label className="pos-label">Địa chỉ giao xe</label>
                  <textarea
                    className="pos-input pos-textarea"
                    rows={2}
                    placeholder="Địa chỉ giao xe (mặc định địa chỉ KH)"
                    value={diaChiGiao}
                    onChange={e => setDiaChiGiao(e.target.value)}
                  />
                </div>
                <div className="pos-tl-list">
                  <label className="pos-label">Tài liệu xuất kèm</label>
                  {['Hóa đơn bán hàng', 'Hợp đồng mua bán', 'Phiếu bảo hành', 'Biên bản giao xe'].map(tl => (
                    <div key={tl} className="pos-tl-item"><span className="pos-tl-check">✓</span><span>{tl}</span></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ══════ CỘT 3 ══════ */}
        <div className="pos-col pos-col-narrow">
          <div className="pos-card">
            <div className="pos-card-header">
              <span className="pos-step-badge">3</span>
              <span className="pos-card-title">Thanh Toán &amp; Tổng Hợp</span>
            </div>
            <div className="pos-card-body">

              {/* Hình thức */}
              <div className="pos-section-label">Hình thức thanh toán</div>
              <div className="pos-hinhthuc-row">
                <button className={`pos-hinhthuc-btn${hinhThuc === 'tra_thang' ? ' active' : ''}`} onClick={() => { setHinhThuc('tra_thang'); setPhuongThuc('cash'); }}>
                  <span>💵</span> Trả thẳng
                </button>
                <button className={`pos-hinhthuc-btn${hinhThuc === 'tra_gop' ? ' active' : ''}`} onClick={() => { setHinhThuc('tra_gop'); setPhuongThuc('installment'); }}>
                  <span>🏦</span> Trả góp
                </button>
              </div>

              {/* Form trả góp */}
              {hinhThuc === 'tra_gop' && (
                <div className="pos-tragop-form">
                  <div className="pos-field">
                    <label className="pos-label">Ngân hàng / Công ty tài chính <span className="pos-required">*</span></label>
                    <input className="pos-input pos-input-sm" placeholder="VD: BIDV, VietinBank..." value={traGop.ngan_hang} onChange={e => setTraGop(p => ({ ...p, ngan_hang: e.target.value }))} />
                  </div>
                  <div className="pos-tragop-row">
                    <div className="pos-field">
                      <label className="pos-label">Số tháng</label>
                      <select className="pos-input pos-input-sm" value={traGop.so_thang} onChange={e => setTraGop(p => ({ ...p, so_thang: +e.target.value }))}>
                        {[6, 12, 18, 24, 36, 48].map(n => <option key={n} value={n}>{n} tháng</option>)}
                      </select>
                    </div>
                    <div className="pos-field">
                      <label className="pos-label">Lãi suất (%/tháng)</label>
                      <input className="pos-input pos-input-sm" type="number" step="0.1" min="0" value={traGop.lai_suat} onChange={e => setTraGop(p => ({ ...p, lai_suat: +e.target.value }))} />
                    </div>
                  </div>
                  {tienTraGopThang > 0 && (
                    <div className="pos-tragop-result">
                      <span>Trả mỗi tháng:</span>
                      <span className="pos-tragop-amount">{formatCurrency(tienTraGopThang)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Bảng giá */}
              <div className="pos-price-table">
                <div className="pos-price-row">
                  <span>Giá niêm yết</span>
                  <span>{modelChon ? formatCurrency(giaNiemYet) : '—'}</span>
                </div>
                {tongGiamGia !== 0 && (
                  <div className="pos-price-row text-danger">
                    <span>Giảm giá</span>
                    <span>{formatCurrency(tongGiamGia)}</span>
                  </div>
                )}
                {/* Phí cố định từ API */}
                {dsFees.map(f => (
                  <div key={f.id} className="pos-price-row">
                    <span>{f.label}</span>
                    <span>{formatCurrency(f.amount)}</span>
                  </div>
                ))}
                {/* Dịch vụ đăng ký đã chọn */}
                {dsDichVu.filter(s => dichVuChon.has(s.id)).map(s => (
                  <div key={s.id} className="pos-price-row" style={{ color: '#6366f1' }}>
                    <span>{s.name}</span>
                    <span>{formatCurrency(s.price)}</span>
                  </div>
                ))}
                {tongPhKien > 0 && (
                  <div className="pos-price-row pos-price-row-pk">
                    <span>
                      Phụ kiện
                      <span className="pos-pk-price-count">({gioPhKien.length} loại)</span>
                    </span>
                    <span>{formatCurrency(tongPhKien)}</span>
                  </div>
                )}
                {/* Quà tặng từ KM gift/combo */}
                {khuyenMai
                  .filter(k => k._checked && (k.promo_type === 'gift' || k.promo_type === 'combo') && k.gift_items)
                  .map(km => (
                    <div key={km.id} className="pos-price-row" style={{ color: '#6b21a8' }}>
                      <span>🎁 {km.gift_items!.name} ×{km.gift_quantity}</span>
                      <span style={{ fontSize: 12 }}>Tặng kèm</span>
                    </div>
                  ))}
                <div className="pos-price-total-row">
                  <span>Tổng thanh toán</span>
                  <span className="pos-price-total">{formatCurrency(tongThanhToan)}</span>
                </div>
              </div>

              {/* Phương thức TT */}
              {hinhThuc === 'tra_thang' && (
                <>
                  <div className="pos-section-label">Phương thức thanh toán</div>
                  <div className="pos-pttt-row">
                    {([
                      { key: 'cash',          icon: '💵', label: 'Tiền mặt'    },
                      { key: 'bank_transfer', icon: '🏦', label: 'Chuyển khoản' },
                      { key: 'qr',            icon: '📱', label: 'QR Code'      },
                    ] as const).map(pt => (
                      <button
                        key={pt.key}
                        className={`pos-pttt-btn${phuongThuc === pt.key ? ' active' : ''}`}
                        onClick={() => setPhuongThuc(pt.key)}
                      >
                        <span className="pos-pttt-icon">{pt.icon}</span>
                        <span className="pos-pttt-label">{pt.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Đặt cọc */}
              <div className="pos-field">
                <label className="pos-label">Đặt cọc / Thu trước</label>
                <div className="pos-input-wrap">
                  <span className="pos-input-prefix">₫</span>
                  <input
                    className="pos-input pos-input-money"
                    type="text"
                    placeholder="0"
                    value={datCoc}
                    onChange={e => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setDatCoc(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                    }}
                  />
                </div>
              </div>

              {/* Còn lại */}
              {datCocNum > 0 && (
                <div className="pos-con-lai">
                  <span>Còn lại phải thu</span>
                  <span className="pos-con-lai-val">{formatCurrency(conLaiNum)}</span>
                </div>
              )}

              {/* Tiền khách đưa */}
              <div className="pos-field">
                <label className="pos-label">Tiền khách đưa</label>
                <div className="pos-input-wrap">
                  <span className="pos-input-prefix">₫</span>
                  <input
                    className="pos-input pos-input-money"
                    type="text"
                    placeholder={formatCurrency(conLaiNum).replace(' ₫', '').trim()}
                    value={tienKhach}
                    onChange={e => {
                      const raw = e.target.value.replace(/\D/g, '');
                      setTienKhach(raw ? parseInt(raw, 10).toLocaleString('vi-VN') : '');
                    }}
                  />
                </div>
              </div>

              {/* Tiền thối */}
              <div className={`pos-tien-thoi${tienThoiNum > 0 ? ' has-thoi' : ''}`}>
                <span>Tiền trả khách</span>
                <span className="pos-tien-thoi-val">{tienThoiNum > 0 ? formatCurrency(tienThoiNum) : '0 đ'}</span>
              </div>

              {/* Tóm tắt đơn */}
              {(modelChon || khachHang) && (
                <div className="pos-don-summary">
                  {modelChon && (
                    <div className="pos-don-xe">
                      <span>🏍️</span>
                      <div>
                        <div className="pos-don-xe-name">{modelChon.brand} {modelChon.model_name}</div>
                        {phienBanChon && <div className="pos-don-xe-sub">Phiên bản: {phienBanChon}</div>}
                        {mauChon && <div className="pos-don-xe-sub">Màu {mauChon} · Còn: {soLuongConHang} xe</div>}
                        {vehicleChon && <div className="pos-don-xe-vin">VIN: {vehicleChon.vin}</div>}
                      </div>
                    </div>
                  )}
                  {khachHang && (
                    <div className="pos-don-kh">
                      <span>👤</span>
                      <div>{khachHang.full_name} · {khachHang.phone}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ════ FOOTER ════ */}
      <div className="pos-footer">
        <button className="btn btn-secondary" onClick={() => navigate('/sales')}>Huỷ đơn</button>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {soLuongConHang === 0 && modelChon && mauChon && (
            <span className="pos-warning-text">⚠️ Hết hàng màu {mauChon}</span>
          )}
          <button className="btn btn-secondary pos-btn-draft" onClick={handleLuuTam} disabled={taodonMut.isPending}>
            💾 Lưu tạm
          </button>
          <button
            className="btn pos-btn-confirm"
            onClick={handleXacNhan}
            disabled={taodonMut.isPending || (!!mauChon && soLuongConHang === 0)}
          >
            {taodonMut.isPending
              ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Đang xử lý...</>
              : '✅ Xác nhận & Xuất hoá đơn'}
          </button>
        </div>
      </div>

      {/* ════ MODAL THÊM KHÁCH HÀNG MỚI ════ */}
      {showModalKH && (
        <div className="modal-overlay" onClick={() => setShowModalKH(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">👤 Thêm khách hàng mới</span>
              <button className="modal-close" onClick={() => setShowModalKH(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Họ tên <span className="pos-required">*</span></label>
                  <input
                    className="form-control"
                    placeholder="Nguyễn Văn A"
                    value={formKhachMoi.full_name}
                    onChange={e => setFormKhachMoi(p => ({ ...p, full_name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Số điện thoại <span className="pos-required">*</span></label>
                  <input
                    className="form-control"
                    placeholder="0987 123 456"
                    value={formKhachMoi.phone}
                    onChange={e => setFormKhachMoi(p => ({ ...p, phone: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">CCCD/CMND</label>
                  <input
                    className="form-control"
                    placeholder="079123456789"
                    value={formKhachMoi.id_card}
                    onChange={e => setFormKhachMoi(p => ({ ...p, id_card: e.target.value }))}
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1/-1' }}>
                  <label className="form-label">Địa chỉ</label>
                  <input
                    className="form-control"
                    placeholder="123 Đường Lê Lợi, Quận 1, TP.HCM"
                    value={formKhachMoi.address}
                    onChange={e => setFormKhachMoi(p => ({ ...p, address: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModalKH(false)}>Huỷ</button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!formKhachMoi.full_name.trim()) { toast.error('Nhập họ tên khách hàng'); return; }
                  if (!formKhachMoi.phone.trim())     { toast.error('Nhập số điện thoại');      return; }
                  taoKHMut.mutate(formKhachMoi);
                }}
                disabled={taoKHMut.isPending}
              >
                {taoKHMut.isPending ? 'Đang tạo...' : '✓ Tạo khách hàng'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helper màu → CSS color ───────────────────────────────────────────────────
function mauToMa(mau: string): string {
  const MAP: Record<string, string> = {
    'trắng': '#f3f4f6', 'trang': '#f3f4f6',
    'đen':   '#1f2937', 'den':   '#1f2937',
    'đỏ':    '#dc2626', 'do':    '#dc2626',
    'xanh dương': '#2563eb', 'xanh lam': '#2563eb',
    'xanh lá':    '#16a34a', 'xanh':     '#2563eb',
    'vàng':  '#ca8a04', 'vang':  '#ca8a04',
    'cam':   '#ea580c',
    'bạc':   '#9ca3af', 'bac':   '#9ca3af',
    'nâu':   '#92400e', 'nau':   '#92400e',
    'hồng':  '#db2777', 'hong':  '#db2777',
    'tím':   '#7c3aed', 'tim':   '#7c3aed',
  };
  return MAP[mau.toLowerCase()] ?? '#9ca3af';
}
