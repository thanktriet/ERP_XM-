// Sidebar + Layout chính
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { getInitials } from '../utils/helpers';
import toast from 'react-hot-toast';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const laAdminOrManager = user?.role === 'admin' || user?.role === 'manager';

  // Nav động theo quyền
  const NAV = [
    {
      section: 'Tổng quan',
      items: [{ to: '/', label: 'Dashboard', icon: '📊' }],
    },
    {
      section: 'Kinh doanh',
      items: [
        { to: '/customers', label: 'Khách hàng', icon: '👥' },
        { to: '/sales', label: 'Đơn hàng', icon: '🛒' },
      ],
    },
    {
      section: 'Kho & Xe',
      items: [
        { to: '/vehicles', label: 'Mẫu xe', icon: '🏍️' },
        { to: '/inventory', label: 'Tồn kho xe', icon: '📦' },
        { to: '/spare-parts', label: 'Phụ tùng', icon: '🔩' },
        { to: '/accessories', label: 'Phụ kiện', icon: '🎒' },
        { to: '/gifts', label: 'Quà tặng', icon: '🎁' },
        { to: '/promotions', label: 'Khuyến mãi', icon: '🎉' },
        { to: '/purchase-orders', label: 'Đơn nhập hàng', icon: '📋' },
        { to: '/suppliers', label: 'Nhà cung cấp', icon: '🏭' },
      ],
    },
    {
      section: 'Dịch vụ',
      items: [
        { to: '/warranty', label: 'Bảo hành', icon: '🛡️' },
        { to: '/services', label: 'Phiếu dịch vụ', icon: '🔧' },
      ],
    },
    {
      section: 'Tài chính',
      items: [
        { to: '/finance', label: 'Thu chi', icon: '💰' },
        { to: '/accounting/cashflow', label: 'Tồn quỹ', icon: '🏦' },
      ],
    },
    // Quản trị: chỉ hiện với admin/manager
    ...(laAdminOrManager ? [{
      section: 'Quản trị',
      items: [
        { to: '/users', label: 'Nhân viên', icon: '👤' },
        { to: '/settings', label: 'Cấu hình', icon: '⚙️' },
      ],
    }] : []),
  ];

  const handleLogout = () => {
    logout();
    toast.success('Đã đăng xuất');
    navigate('/login');
  };

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <h1>⚡ ERP Xe Máy Điện</h1>
          <p>Quản lý đại lý xe điện</p>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(group => (
            <div className="nav-section" key={group.section}>
              <div className="nav-section-title">{group.section}</div>
              {group.items.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <span style={{ fontSize: 16 }}>{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{getInitials(user?.full_name || '?')}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.full_name}
              </div>
              <div className="user-role">{user?.role}</div>
            </div>
            <button
              className="btn btn-icon"
              onClick={handleLogout}
              title="Đăng xuất"
              style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
