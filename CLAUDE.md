# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Tổng quan dự án

Hệ thống ERP quản lý đại lý xe máy điện. Ứng dụng full-stack JavaScript gồm backend Node.js/Express và frontend React/TypeScript. **Toàn bộ comment, tên biến, thông báo lỗi và chuỗi hiển thị đều dùng tiếng Việt.**

## Lệnh phát triển

### Backend (cổng 5000)
```bash
cd backend
npm install
npm run dev        # Phát triển với nodemon
npm start          # Production
```

### Frontend (cổng 3000)
```bash
cd frontend
npm install
npm run dev        # Vite dev server với HMR
npm run build      # Kiểm tra TypeScript + build production
npm run lint       # ESLint
npm run preview    # Xem trước bản build production
```

### Cơ sở dữ liệu
Không có migration runner — chạy toàn bộ nội dung `backend/migrations/schema.sql` trực tiếp trong Supabase SQL Editor để tạo tất cả bảng, view và trigger.

**Chưa có framework kiểm thử nào được cấu hình.**

## Cấu hình môi trường

Sao chép `backend/.env.example` thành `backend/.env` và điền vào:
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — lấy từ cài đặt dự án Supabase
- `JWT_SECRET` — phải khớp với JWT secret của dự án Supabase
- `FRONTEND_URL=http://localhost:3000` — dùng cho CORS

Frontend proxy các request `/api` tới `http://localhost:5000` (cấu hình trong `vite.config.ts`).

## Kiến trúc

**Monorepo** với hai thư mục riêng biệt `backend/` và `frontend/`.

```
React SPA (cổng 3000)
    ↓ proxy /api
Express API (cổng 5000)
    ↓ Supabase client (service role key — bỏ qua RLS)
PostgreSQL qua Supabase
```

### Backend (`backend/src/`)

Theo mô hình MVC với Express:
- `server.js` — khởi tạo app, gắn tất cả route, áp dụng handler lỗi/404
- `config/supabase.js` — export một Supabase admin client duy nhất (service role)
- `middleware/auth.middleware.js` — export `authenticate` (xác thực JWT) và `authorize(...roles)` (kiểm tra vai trò)
- `middleware/validate.middleware.js` — bọc express-validator; dùng sau các chuỗi validator trong route
- `routes/*.routes.js` — định nghĩa endpoint, áp dụng middleware, gọi controller
- `controllers/*.controller.js` — toàn bộ business logic và câu truy vấn Supabase
- `validators/*.validator.js` — mảng các rule của express-validator

Mẫu route:
```js
router.post('/', validationRules, validate, controller);
```

Route được bảo vệ dùng:
```js
router.use(authenticate);
router.get('/chi-admin', authorize('admin', 'manager'), controller);
```

### Frontend (`frontend/src/`)

- `App.tsx` — cấu hình React Router; `PrivateRoute` kiểm tra token từ `useAuthStore`
- `store/authStore.ts` — Zustand store; lưu `token` và `user` vào localStorage
- `services/api.ts` — Axios instance; interceptor tự động gắn `Authorization: Bearer <token>` và xử lý lỗi 401
- `types/index.ts` — toàn bộ TypeScript interface dùng chung
- Các trang nằm trong `pages/`; `Layout.tsx` bọc tất cả trang đã xác thực với sidebar điều hướng

React Query được cấu hình với `staleTime: 30000` trong `App.tsx`.

## Những điểm quan trọng về schema CSDL

11 bảng trong PostgreSQL (qua Supabase). Tất cả khóa chính là UUID (`uuid_generate_v4()`). Tất cả bảng có `created_at` (DEFAULT NOW()) và `updated_at` (tự cập nhật qua trigger `trg_updated_at`).

**Mã nghiệp vụ tự sinh** (tính từ số lượng bản ghi lúc insert):
- Khách hàng: định dạng `KH000001`
- Đơn hàng: định dạng `DH2026001` (có tiền tố năm)
- Bảo hành: định dạng `BH000001`

**Trigger quan trọng**: `trg_stock_movement` — tự động điều chỉnh `spare_parts.qty_in_stock` khi có bản ghi mới trong `stock_movements`.

**Hai view**:
- `v_vehicle_stock_summary` — nhóm `inventory_vehicles` theo model, đếm theo trạng thái
- `v_monthly_revenue` — tổng hợp `finance_transactions` theo tháng (thu/chi/lợi nhuận)

**Enum trạng thái** (ràng buộc qua CHECK constraint, không dùng PostgreSQL enum):
- `inventory_vehicles.status`: `in_stock | sold | reserved | warranty_repair`
- `sales_orders.status`: `draft | confirmed | deposit_paid | full_paid | delivered`
- `warranty_records.status`: `active | expired | voided`
- `users.role`: `admin | manager | sales | technician | accountant | warehouse`

## Quy ước phản hồi API

Thành công (danh sách):
```json
{ "data": [...], "total": 100, "page": 1, "limit": 20 }
```

Lỗi:
```json
{ "success": false, "error": "thông báo lỗi", "details": [...] }
```

Phân trang dùng Supabase `.range((page-1)*limit, page*limit-1)`.

## Trạng thái hoàn thành hiện tại

- **Controller backend**: auth, customers, inventory đã hoàn thiện; sales, warranty, finance, reports còn logic chưa đầy đủ
- **Trang frontend**: tất cả file trang đã có nhưng hầu hết là placeholder trống — phần việc chính còn lại là triển khai các component trang và kết nối với API
- **Chưa có thư viện logging** — chỉ có `console.error` trong error middleware
- **Chưa có transaction nguyên tử** — các thao tác CSDL nhiều bước trong controller chưa được bọc trong transaction


<!-- ClaudeVibeCodeKit -->
## ClaudeVibeCodeKit

### Planning
When planning complex tasks:
1. Read .claude/docs/plan-execution-guide.md for format guide
2. Use planning-agent for parallel execution optimization
3. Output plan according to .claude/schemas/plan-schema.json

### Available Commands
- /research - Deep web research
- /meeting-notes - Live meeting notes
- /changelog - Generate changelog
- /onboard - Developer onboarding
- /handoff - Create handoff document for conversation transition
- /continue - Resume work from a handoff document
- /watzup - Check current project status
- /social-media-post - Social content workflow
<!-- /ClaudeVibeCodeKit -->
