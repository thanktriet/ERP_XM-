// Trang đăng nhập
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

function thongBaoLoiDangNhap(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
  if (!e?.response) {
    return 'Không kết nối được API. Trên GitHub Pages cần cấu hình secret VITE_API_BASE_URL trỏ tới backend (và backend phải bật CORS cho domain Pages).';
  }
  const st = e.response.status;
  const msg = e.response.data?.error;
  if (msg) return msg;
  if (st === 404) {
    return 'Không tìm thấy API (404). Kiểm tra VITE_API_BASE_URL khi build — không dùng được đường dẫn /api trên github.io.';
  }
  if (st !== undefined && st >= 500) return 'Lỗi máy chủ. Thử lại sau.';
  return 'Email hoặc mật khẩu không đúng';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      toast.success('Đăng nhập thành công!');
      navigate('/');
    } catch (err: unknown) {
      toast.error(thongBaoLoiDangNhap(err));
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
          <h1>ERP Xe Máy Điện</h1>
          <p>Hệ thống quản lý đại lý xe điện</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email <span className="required">*</span></label>
            <input
              className="form-control"
              type="email"
              placeholder="admin@erp.vn"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Mật khẩu <span className="required">*</span></label>
            <input
              className="form-control"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={isLoading}
            style={{ width: '100%', justifyContent: 'center', padding: '11px' }}
          >
            {isLoading ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Đang đăng nhập...</> : 'Đăng nhập'}
          </button>
        </form>
      </div>
    </div>
  );
}
