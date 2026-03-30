import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useEffect } from 'react';

import { useAuthStore } from './store/authStore';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CustomersPage from './pages/CustomersPage';
import SalesPage from './pages/SalesPage';
import VehiclesPage from './pages/VehiclesPage';
import InventoryPage from './pages/InventoryPage';
import WarrantyPage from './pages/WarrantyPage';
import FinancePage from './pages/FinancePage';
import SalesNewPage from './pages/SalesNewPage';
import UsersPage from './pages/UsersPage';
import SparePartsPage from './pages/SparePartsPage';
import AccessoriesPage from './pages/AccessoriesPage';
import GiftsPage from './pages/GiftsPage';
import PromotionsPage from './pages/PromotionsPage';
import PurchaseOrdersPage from './pages/PurchaseOrdersPage';
import SuppliersPage from './pages/SuppliersPage';
import PaymentPage from './pages/PaymentPage';
import CashflowPage from './pages/CashflowPage';

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/** GitHub Pages: app nằm dưới /<tên-repo>/ — basename khớp Vite `base` */
function routerBasename(): string | undefined {
  const b = import.meta.env.BASE_URL;
  if (b === '/') return undefined;
  return b.endsWith('/') ? b.slice(0, -1) : b;
}

// Guard: kiểm tra đăng nhập — chờ init() xong rồi mới quyết định redirect
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, isInitialized } = useAuthStore();
  // Chưa đọc xong localStorage → giữ nguyên, không redirect vội
  if (!isInitialized) return null;
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  const { init } = useAuthStore();
  useEffect(() => { init(); }, [init]);

  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter basename={routerBasename()}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="sales/new" element={<SalesNewPage />} />
            <Route path="vehicles" element={<VehiclesPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="spare-parts" element={<SparePartsPage />} />
            <Route path="accessories" element={<AccessoriesPage />} />
            <Route path="gifts" element={<GiftsPage />} />
            <Route path="promotions" element={<PromotionsPage />} />
            <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="suppliers" element={<SuppliersPage />} />
            <Route path="warranty" element={<WarrantyPage />} />
            <Route path="services" element={<WarrantyPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="users" element={<UsersPage />} />
            {/* Module kế toán */}
            <Route path="payment/:orderId" element={<PaymentPage />} />
            <Route path="accounting/cashflow" element={<CashflowPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
    </QueryClientProvider>
  );
}

