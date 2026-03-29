// Axios instance với base URL và interceptor tự động gắn token
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Tự động gắn token vào header
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Biến flag tránh gọi refresh nhiều lần cùng lúc (race condition)
let isRefreshing = false;
let waitingQueue: Array<(token: string | null) => void> = [];

function processQueue(newToken: string | null) {
  waitingQueue.forEach((resolve) => resolve(newToken));
  waitingQueue = [];
}

// Xử lý lỗi global: 401 → thử refresh token trước, nếu thất bại mới redirect login
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const originalRequest = err.config;

    if (err.response?.status === 401) {
      const url    = String(originalRequest?.url ?? '');
      const method = String(originalRequest?.method ?? '').toLowerCase();

      // Sai mật khẩu khi đăng nhập hoặc chính endpoint refresh thất bại
      // → không thử refresh, trả lỗi về cho caller xử lý
      if (
        (url.includes('/auth/login') && method === 'post') ||
        url.includes('/auth/refresh')
      ) {
        return Promise.reject(err);
      }

      // Đã thử refresh rồi vẫn 401 → bỏ cuộc
      if (originalRequest._retry) {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('expiresAt');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(err);
      }

      // Nếu đang refresh → đưa request vào hàng đợi
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          waitingQueue.push((newToken) => {
            if (newToken) {
              originalRequest.headers.Authorization = `Bearer ${newToken}`;
              resolve(api(originalRequest));
            } else {
              reject(err);
            }
          });
        });
      }

      // Thử refresh token
      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        isRefreshing = false;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(err);
      }

      try {
        const { data } = await api.post('/auth/refresh', { refreshToken });
        const newToken = data.token as string;

        localStorage.setItem('token',        newToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        localStorage.setItem('expiresAt',    String(data.expiresAt));

        // Cập nhật store mà không gây circular import
        // (store cũng tự cập nhật khi interceptor gọi refreshAccessToken)
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;

        processQueue(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch {
        processQueue(null);
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('expiresAt');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(err);
  }
);

export default api;
