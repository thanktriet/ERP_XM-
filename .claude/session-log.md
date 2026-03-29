# 📋 Lịch sử phiên làm việc — ERP Xe Máy Điện

> File này được tự động cập nhật sau mỗi phiên Claude Code.
> Chỉnh sửa thủ công phần "Bước tiếp theo" sau mỗi phiên.

---

## 📅 Phiên: 29/03/2026 — Khởi tạo lịch sử

### ✅ Tính năng đã hoàn thành

#### 🔐 Xác thực (Auth)
- Sửa lỗi bị văng ra ngoài do token hết hạn sau 1 giờ
- Implement **Refresh Token** tự động — backend trả `refreshToken` + `expiresAt` khi login
- Thêm endpoint `POST /api/auth/refresh`
- `api.ts`: khi nhận 401 → tự gọi refresh rồi retry request, không redirect login ngay
- `authStore.ts`: lưu `refreshToken` + `expiresAt`, hàm `refreshAccessToken()`
- `App.tsx / PrivateRoute`: chờ `isInitialized` trước khi redirect, tránh flash khi F5

#### 👥 Khách hàng
- Sửa bug `customer_code` không được tạo (controller dùng sai tên cột `code`)
- Sửa search dùng đúng cột `customer_code`
- Bổ sung form: CCCD/CMND, ngày sinh, tỉnh/thành phố, tên công ty, mã số thuế, ghi chú
- Cập nhật `Customer` interface trong `types/index.ts`
- Cập nhật validator backend để nhận thêm các trường mới

#### 📦 Kho xe — Import Excel
- Cài thư viện `xlsx` vào backend
- Tạo `inventoryImport.controller.js` với 3 endpoint:
  - `GET /api/inventory/import/template` — tải file Excel mẫu 3 sheet
  - `POST /api/inventory/import/preview` — parse + validate từng dòng
  - `POST /api/inventory/import/confirm` — bulk insert vào kho
- Nhận tên cột tiếng Việt có dấu / không dấu / tiếng Anh
- Frontend: modal 2 bước (chọn file → preview bảng → xác nhận)
- Drag & drop file, thống kê hợp lệ/lỗi, checkbox bỏ tick từng dòng

#### 🏗️ Kiến trúc
- Tạo `accounting.controller.js` + `accounting.routes.js` (kế toán VAS, chứng từ, NCC)
- Tạo `purchaseOrder.controller.js` + `purchaseOrder.routes.js` (đơn nhập hàng + phiếu nhận)
- Đăng ký 2 router mới vào `server.js`: `/api/accounting`, `/api/purchase-orders`

#### ⚙️ Cấu hình
- Thiết lập hook tự động ghi lịch sử phiên (`Stop` hook + `PostToolUse` hook)

---

### 🔜 Bước tiếp theo (cập nhật thủ công)

- [ ] Hoàn thiện trang **Bán hàng** (`SalesPage`, `SalesNewPage`) — kết nối API
- [ ] Hoàn thiện trang **Bảo hành** (`WarrantyPage`)
- [ ] Hoàn thiện trang **Tài chính** (`FinancePage`)
- [ ] Hoàn thiện trang **Dashboard** — kết nối số liệu thật
- [ ] Tạo schema SQL cho bảng `purchase_orders`, `purchase_receipts`, `po_payments`
- [ ] Tạo schema SQL cho module kế toán (`acc_vouchers`, `acc_accounts`, `acc_suppliers`...)
- [ ] Kiểm thử toàn bộ luồng import Excel kho xe
- [ ] Thêm phân trang cho trang Bảo hành, Tài chính

