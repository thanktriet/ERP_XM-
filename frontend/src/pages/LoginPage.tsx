// Trang đăng nhập
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

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
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Email hoặc mật khẩu không đúng');
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
