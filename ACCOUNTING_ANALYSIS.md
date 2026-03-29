# PHAN TICH CAU TRUC DB & MODULE KE TOAN - ERP Xe May Dien

Ngay phan tich: 29/03/2026
Muc tieu: Thiet ke module ke toan tich hop voi he thong hien tai

---

## 1. CAU TRUC DATABASE HIEN TAI

### Bang Chinh

#### USERS (Nhan vien)
- Role: admin, manager, sales, technician, accountant, warehouse
- Chu y: Role 'accountant' da san sang

#### VEHICLE_MODELS (Dong xe)
- price_cost (gia nhap) - KHOA tinh COGS
- price_sell (gia ban) - KHOA doanh thu

#### INVENTORY_VEHICLES (Kho xe)
- import_price - Chi phi von hang ban
- status: in_stock, sold, reserved, warranty_repair, demo

#### SALES_ORDERS (Don hang)
- 12 trang thai, state machine ro rang
- total_amount, deposit_amount
- receipt_number (phieu thu), payment_method

#### FINANCE_TRANSACTIONS (Thu chi)
- type: income/expense
- category: ban_hang, bao_hanh, mua_hang, luong, ...
- reference_id + reference_type
- Tu dong tao khi order full_paid (income, ban_hang)

---

## 2. FINANCE TRANSACTIONS

### Hien Tai (4 API):
GET /api/finance - Danh sach giao dich
POST /api/finance - Tao thu cong
GET /api/finance/monthly-revenue - Bao cao theo thang
GET /api/finance/summary - Tong quan thang nay

### Tu dong tu Sales Order:
- status = full_paid - Tao FT (income, ban_hang)
- So hieu: THU-{order_number}-{receipt_number}

### VAN DE:
- Chi ghi Thu, khong ghi Chi (COGS)
- Loi nhuan tinh sai

---

## 3. SALES ORDER WORKFLOW - 12 TRANG THAI

draft - confirmed - deposit_paid - full_paid - invoice_requested - 
invoice_approved - pdi_pending - pdi_done - delivered

Moi trang thai - cancelled

### Financial Impact:

CONFIRMED
- Xe: in_stock - reserved
- FT: Khong

DEPOSIT_PAID
- FT: KHONG TAO (LOI)
- Nen tao: Debit Cash, Credit Deferred Revenue

FULL_PAID (OK)
- OK Tao FT: income, ban_hang
- Xe: reserved - sold
- Phieu thu: receipt_number
- Nen them COGS entry

DELIVERED
- Tao WARRANTY_RECORDS tu dong
- Nen: COGS entry

CANCELLED
- Canh bao: Neu cancelled o full_paid - Cần hoàn tien
- Xe: Tra ve in_stock
- FT: KHONG HOAN HUY (LOI)

---

## 4. THIEU SOT HIEN TAI

### Cap Do CRITICAL (PRIORITY 1):

1. KHONG CO CHART OF ACCOUNTS
   - category la TEXT - khong chuan
   - Khong the map tai khoan ke toan VN (1010, 4110, 5110, ...)

2. KHONG GHI NHAN COGS
   - Loi nhuan = Doanh thu (SAI)
   - Mat khoan "Chi phi von hang ban"

3. KHONG CO JOURNAL ENTRIES (debit/credit)
   - Chi luu 1 dong = 1 giao dich
   - Khong the tao bang can doi

4. TIEN CAP (deposit) KHONG GHI
   - deposit_paid - Khong tao FT
   - Tai khoan "Phai tra khach" khong cap nhat

5. HOA DON KHONG QUAN LY
   - receipt_number la TEXT, khong co bang invoices
   - Khong track "Hoa don chua thanh toan"

### Cap Do IMPORTANT (PRIORITY 2):

6. Khach hang no (AR) khong tracked
7. Nha cung cap no (AP) khong tracked
8. Khong co audit trail
9. Khong co bao cao P&L, Balance Sheet, AR Aging
10. Quy trinh duyet giao dich khong enforce

---

## 5. KHUYEN NGH THIET KE

### Bang Can Tao:

chart_of_accounts - Danh muc TK - PRIORITY 1
journal_entries - Phieu ke toan - PRIORITY 1
journal_entry_lines - Chi tiet JE - PRIORITY 1
invoices - Quan ly hoa don - PRIORITY 1
accounts_receivable - Khach no - PRIORITY 2
expense_categories - Danh muc chi phi - PRIORITY 2
cost_of_goods_sold - COGS entry - PRIORITY 1

---

## 6. VD GHI NHAN DOANH THU

Scenario: Khach A mua xe 500M, cap 50M ngay, 1 tuan sau tra du 450M

T1: Order CONFIRMED
- FT: None
- JE: None

T2: Order DEPOSIT_PAID (50M) - MISSING
- Nen tao JE:
  - Debit:  1010 (Tien)           50M
  - Credit: 2020 (Phai tra)       50M

T3: Order FULL_PAID (450M) - OK
- FT: OK Tao (income, ban_hang, 500M)
- Nen tao JE 1 (Thu tien):
  - Debit:  1010 (Tien)           450M
  - Debit:  2020 (Phai tra)        50M
  - Credit: 4110 (Doanh thu)      500M

T4: Order DELIVERED
- Nen tao JE 2 (COGS):
  - Debit:  5110 (Chi phi von)    350M
  - Credit: 1040 (Hang ton)       350M

P&L (Thang nay):
Doanh thu:              +500M
Chi phi von:            -350M
Loi nhuan gop:          +150M

---

## 7. PHASE TRIEN KHAI

Phase 1 (1-2 tuan): Foundation
- Tao chart_of_accounts + seed VN accounts
- Tao journal_entries + journal_entry_lines
- API CRUD Chart of Accounts

Phase 2 (1-2 tuan): Invoices
- Tao bang invoices
- API CRUD invoices
- Tax calculation

Phase 3 (2 tuan): Auto JE + COGS
- Trigger: sales_order.full_paid - Tao JE 1 + JE 2
- Trigger: deposit_paid - Tao JE tien cap
- Reverse entries khi cancelled

Phase 4 (2 tuan): Reporting
- v_income_statement view
- v_balance_sheet view
- API report endpoints

Phase 5 (1 tuan): AR Management
- accounts_receivable table
- Aging report
- AR Dashboard

Phase 6 (1 tuan): Period Closing
- Period closing logic
- Audit trail
- Lock/unlock periods

TIMELINE UOCTNH: 8-10 tuan cho MVP accounting module

