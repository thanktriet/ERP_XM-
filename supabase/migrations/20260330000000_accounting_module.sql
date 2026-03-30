-- ============================================================
-- Module Kế Toán Đơn Giản — ERP Xe Máy Điện
-- Migration: 20260330000000_accounting_module
-- Triết lý: ERP lo vận hành nhanh, AMIS lo sổ sách sâu
-- ============================================================

-- Kích hoạt extension cần thiết
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- BẢNG PHỤ TRỢ: accounting_user_profiles
-- Được tạo trong file 20260330000001_notifications_and_acc_profiles.sql
-- (sau khi acc_branches và acc_organizations đã tồn tại)
-- Các helper function dưới đây đọc từ bảng đó.
-- ============================================================

-- Helper: lấy acc_role của user hiện tại
CREATE OR REPLACE FUNCTION get_accounting_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT acc_role FROM accounting_user_profiles WHERE id = auth.uid();
$$;

-- Helper: lấy default_branch_id của user hiện tại
CREATE OR REPLACE FUNCTION get_accounting_branch_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT default_branch_id FROM accounting_user_profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- 1. BẢNG PHIẾU THU (receipts)
-- ============================================================
CREATE TABLE receipts (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã phiếu tự sinh: PT + YYYYMMDD + sequence
  receipt_code    TEXT        UNIQUE NOT NULL,

  -- Liên kết nghiệp vụ
  order_id        UUID        REFERENCES sales_orders(id),
  customer_id     UUID        REFERENCES customers(id),
  branch_id       UUID        NOT NULL,

  -- Số tiền (VND, không có số lẻ)
  amount          INTEGER     NOT NULL CHECK (amount > 0),

  -- Phương thức thanh toán
  payment_method  TEXT        NOT NULL CHECK (
    payment_method IN ('bank_transfer', 'cash', 'debt')
  ),

  -- Thông tin ngân hàng (từ SEPay)
  bank_ref_code   TEXT,       -- referenceCode từ SEPay (dùng idempotency)
  bank_account    TEXT,       -- số tài khoản ngân hàng
  match_type      TEXT CHECK (
    match_type IN ('matched_full', 'matched_partial', 'matched_excess', 'manual')
  ),

  -- Trạng thái phiếu
  status          TEXT        NOT NULL DEFAULT 'confirmed' CHECK (
    status IN ('pending', 'confirmed', 'voided')
  ),

  note            TEXT,

  -- Trạng thái đồng bộ AMIS
  amis_sync_status TEXT       NOT NULL DEFAULT 'pending' CHECK (
    amis_sync_status IN ('pending', 'synced', 'failed', 'excluded')
  ),

  -- Audit trail
  created_by      UUID        REFERENCES auth.users(id),
  voided_by       UUID        REFERENCES auth.users(id),
  voided_at       TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger tự sinh receipt_code dạng PT20260330001
CREATE OR REPLACE FUNCTION generate_receipt_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date   TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD');
  v_count  INTEGER;
  v_code   TEXT;
BEGIN
  SELECT COUNT(*) + 1
    INTO v_count
    FROM receipts
   WHERE receipt_code LIKE 'PT' || v_date || '%';
  v_code := 'PT' || v_date || LPAD(v_count::TEXT, 3, '0');
  NEW.receipt_code := v_code;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_receipts_code
  BEFORE INSERT ON receipts
  FOR EACH ROW
  WHEN (NEW.receipt_code IS NULL OR NEW.receipt_code = '')
  EXECUTE FUNCTION generate_receipt_code();

CREATE TRIGGER trg_receipts_updated_at
  BEFORE UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Index thường dùng
CREATE INDEX idx_receipts_order_id     ON receipts(order_id);
CREATE INDEX idx_receipts_branch_date  ON receipts(branch_id, created_at DESC);
CREATE INDEX idx_receipts_bank_ref     ON receipts(bank_ref_code) WHERE bank_ref_code IS NOT NULL;
CREATE INDEX idx_receipts_amis_pending ON receipts(amis_sync_status) WHERE amis_sync_status = 'pending';

-- ============================================================
-- 2. BẢNG PHIẾU CHI (payments)
-- ============================================================
CREATE TABLE payments (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_code    TEXT        UNIQUE NOT NULL,

  branch_id       UUID        NOT NULL,

  -- Phân loại chi
  category        TEXT        NOT NULL CHECK (
    category IN ('supplier', 'salary', 'operating', 'transfer_to_ho', 'other')
  ),

  amount          INTEGER     NOT NULL CHECK (amount > 0),
  description     TEXT        NOT NULL,
  recipient       TEXT,

  -- Luồng duyệt
  approved_by     UUID        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'approved', 'rejected', 'voided')
  ),

  amis_sync_status TEXT       NOT NULL DEFAULT 'pending' CHECK (
    amis_sync_status IN ('pending', 'synced', 'failed', 'excluded')
  ),

  note            TEXT,
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION generate_payment_code()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date  TEXT := TO_CHAR(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD');
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) + 1
    INTO v_count
    FROM payments
   WHERE payment_code LIKE 'PC' || v_date || '%';
  NEW.payment_code := 'PC' || v_date || LPAD(v_count::TEXT, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_code
  BEFORE INSERT ON payments
  FOR EACH ROW
  WHEN (NEW.payment_code IS NULL OR NEW.payment_code = '')
  EXECUTE FUNCTION generate_payment_code();

CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_payments_branch_date  ON payments(branch_id, created_at DESC);
CREATE INDEX idx_payments_amis_pending ON payments(amis_sync_status) WHERE amis_sync_status = 'pending';

-- ============================================================
-- 3. BẢNG TỒN QUỸ (cash_balances)
-- ============================================================
CREATE TABLE cash_balances (
  id                    UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  branch_id             UUID    NOT NULL,
  balance_date          DATE    NOT NULL,

  -- Số dư đầu ngày
  opening_cash          INTEGER NOT NULL DEFAULT 0,
  opening_bank          INTEGER NOT NULL DEFAULT 0,

  -- Phát sinh trong ngày (ERP tự tổng hợp)
  total_receipts_cash   INTEGER NOT NULL DEFAULT 0,
  total_receipts_bank   INTEGER NOT NULL DEFAULT 0,
  total_payments_cash   INTEGER NOT NULL DEFAULT 0,
  total_payments_bank   INTEGER NOT NULL DEFAULT 0,

  -- Số dư cuối ngày tính toán (ERP)
  closing_cash          INTEGER GENERATED ALWAYS AS (
    opening_cash + total_receipts_cash - total_payments_cash
  ) STORED,
  closing_bank          INTEGER GENERATED ALWAYS AS (
    opening_bank + total_receipts_bank - total_payments_bank
  ) STORED,

  -- Kiểm quỹ thực tế (nhập tay khi đóng ngày)
  actual_cash           INTEGER,
  bank_statement_balance INTEGER,

  -- Chênh lệch
  cash_difference       INTEGER GENERATED ALWAYS AS (
    COALESCE(actual_cash, 0) - (opening_cash + total_receipts_cash - total_payments_cash)
  ) STORED,
  bank_difference       INTEGER GENERATED ALWAYS AS (
    COALESCE(bank_statement_balance, 0) - (opening_bank + total_receipts_bank - total_payments_bank)
  ) STORED,

  -- Ngưỡng cảnh báo: quỹ CN không được vượt quá mức này sau 18:00
  max_cash_allowed      INTEGER NOT NULL DEFAULT 50000000, -- 50 triệu

  -- Trạng thái đóng ngày
  status                TEXT    NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'reconciling', 'reconciled', 'discrepancy')
  ),
  closed_at             TIMESTAMPTZ,
  closed_by             UUID    REFERENCES auth.users(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (branch_id, balance_date)
);

CREATE TRIGGER trg_cash_balances_updated_at
  BEFORE UPDATE ON cash_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_cash_balances_branch_date ON cash_balances(branch_id, balance_date DESC);

-- ============================================================
-- 4. BẢNG CÔNG NỢ KHÁCH HÀNG (customer_debts)
-- ============================================================
CREATE TABLE customer_debts (
  id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  customer_id      UUID    NOT NULL REFERENCES customers(id),
  order_id         UUID    REFERENCES sales_orders(id),
  branch_id        UUID    NOT NULL,

  original_amount  INTEGER NOT NULL CHECK (original_amount > 0),
  paid_amount      INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),

  -- Số tiền còn nợ (computed)
  remaining_amount INTEGER GENERATED ALWAYS AS (original_amount - paid_amount) STORED,

  due_date         DATE,
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'partially_paid', 'paid', 'overdue', 'written_off')
  ),

  note             TEXT,
  created_by       UUID    REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_paid_not_exceed CHECK (paid_amount <= original_amount)
);

CREATE TRIGGER trg_customer_debts_updated_at
  BEFORE UPDATE ON customer_debts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tự cập nhật status khi paid_amount thay đổi
CREATE OR REPLACE FUNCTION update_debt_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.paid_amount >= NEW.original_amount THEN
    NEW.status := 'paid';
  ELSIF NEW.paid_amount > 0 THEN
    NEW.status := 'partially_paid';
  ELSIF NEW.due_date IS NOT NULL AND NEW.due_date < CURRENT_DATE AND NEW.status = 'active' THEN
    NEW.status := 'overdue';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_debt_status
  BEFORE UPDATE ON customer_debts
  FOR EACH ROW
  WHEN (OLD.paid_amount IS DISTINCT FROM NEW.paid_amount)
  EXECUTE FUNCTION update_debt_status();

CREATE INDEX idx_customer_debts_customer ON customer_debts(customer_id);
CREATE INDEX idx_customer_debts_status    ON customer_debts(status) WHERE status NOT IN ('paid', 'written_off');

-- ============================================================
-- 5. BẢNG GIAO DỊCH KHÔNG KHỚP (unmatched_transactions)
-- ============================================================
CREATE TABLE unmatched_transactions (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã tham chiếu ngân hàng — UNIQUE để đảm bảo idempotency
  bank_ref_code      TEXT        UNIQUE NOT NULL,
  bank_account       TEXT        NOT NULL,

  amount             INTEGER     NOT NULL,
  transaction_time   TIMESTAMPTZ NOT NULL,
  description        TEXT,

  -- Payload gốc từ SEPay để tra cứu sau
  raw_payload        JSONB       NOT NULL,

  -- Xử lý thủ công
  resolution_status  TEXT        NOT NULL DEFAULT 'pending' CHECK (
    resolution_status IN ('pending', 'manually_matched', 'ignored')
  ),
  matched_receipt_id UUID        REFERENCES receipts(id),
  resolved_by        UUID        REFERENCES auth.users(id),
  resolved_at        TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_unmatched_status   ON unmatched_transactions(resolution_status) WHERE resolution_status = 'pending';
CREATE INDEX idx_unmatched_bank_ref ON unmatched_transactions(bank_ref_code);

-- ============================================================
-- 6. BẢNG QUEUE ĐỒNG BỘ AMIS (amis_sync_queue)
-- ============================================================
CREATE TABLE amis_sync_queue (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Nguồn phát sinh
  source_type       TEXT        NOT NULL CHECK (source_type IN ('receipt', 'payment')),
  source_id         UUID        NOT NULL,
  branch_id         UUID        NOT NULL,
  transaction_date  DATE        NOT NULL,

  -- Định khoản kế toán
  amis_voucher_type TEXT        NOT NULL,  -- PT, PC
  debit_account     TEXT        NOT NULL,  -- TK Nợ (VD: '131', '112')
  credit_account    TEXT        NOT NULL,  -- TK Có (VD: '511', '111')
  amount            INTEGER     NOT NULL,
  description       TEXT,

  -- Payload đầy đủ gửi AMIS
  payload           JSONB       NOT NULL,

  -- Trạng thái đồng bộ
  amis_sync_status  TEXT        NOT NULL DEFAULT 'pending' CHECK (
    amis_sync_status IN ('pending', 'syncing', 'synced', 'failed', 'excluded')
  ),
  retry_count       INTEGER     NOT NULL DEFAULT 0,
  last_error        TEXT,
  amis_reference_id TEXT,       -- ID phiếu bên AMIS sau khi sync thành công
  synced_at         TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Mỗi nguồn chỉ có 1 bản ghi trong queue
  UNIQUE (source_type, source_id)
);

CREATE TRIGGER trg_amis_queue_updated_at
  BEFORE UPDATE ON amis_sync_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_amis_queue_pending ON amis_sync_queue(amis_sync_status, transaction_date)
  WHERE amis_sync_status IN ('pending', 'failed');

-- ============================================================
-- TRIGGER: Tự động cập nhật cash_balances khi có receipt/payment mới
-- ============================================================
CREATE OR REPLACE FUNCTION sync_cash_balance_on_receipt()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date DATE := (NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  -- Tạo hoặc cập nhật cash_balances cho ngày hôm nay
  INSERT INTO cash_balances (branch_id, balance_date)
  VALUES (NEW.branch_id, v_date)
  ON CONFLICT (branch_id, balance_date) DO NOTHING;

  IF TG_OP = 'INSERT' AND NEW.status = 'confirmed' THEN
    UPDATE cash_balances
       SET total_receipts_cash = total_receipts_cash + CASE WHEN NEW.payment_method = 'cash' THEN NEW.amount ELSE 0 END,
           total_receipts_bank = total_receipts_bank + CASE WHEN NEW.payment_method = 'bank_transfer' THEN NEW.amount ELSE 0 END
     WHERE branch_id = NEW.branch_id AND balance_date = v_date;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'confirmed' AND NEW.status = 'voided' THEN
    -- Đảo lại khi void phiếu thu
    UPDATE cash_balances
       SET total_receipts_cash = total_receipts_cash - CASE WHEN OLD.payment_method = 'cash' THEN OLD.amount ELSE 0 END,
           total_receipts_bank = total_receipts_bank - CASE WHEN OLD.payment_method = 'bank_transfer' THEN OLD.amount ELSE 0 END
     WHERE branch_id = OLD.branch_id AND balance_date = v_date;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_cash_on_receipt
  AFTER INSERT OR UPDATE ON receipts
  FOR EACH ROW EXECUTE FUNCTION sync_cash_balance_on_receipt();

CREATE OR REPLACE FUNCTION sync_cash_balance_on_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date DATE := (NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
  INSERT INTO cash_balances (branch_id, balance_date)
  VALUES (NEW.branch_id, v_date)
  ON CONFLICT (branch_id, balance_date) DO NOTHING;

  IF TG_OP = 'INSERT' AND NEW.status = 'approved' THEN
    UPDATE cash_balances
       SET total_payments_cash = total_payments_cash + NEW.amount
     WHERE branch_id = NEW.branch_id AND balance_date = v_date;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Duyệt phiếu chi
    IF OLD.status != 'approved' AND NEW.status = 'approved' THEN
      UPDATE cash_balances
         SET total_payments_cash = total_payments_cash + NEW.amount
       WHERE branch_id = NEW.branch_id AND balance_date = v_date;
    END IF;
    -- Void phiếu chi đã duyệt
    IF OLD.status = 'approved' AND NEW.status = 'voided' THEN
      UPDATE cash_balances
         SET total_payments_cash = total_payments_cash - OLD.amount
       WHERE branch_id = OLD.branch_id AND balance_date = v_date;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_cash_on_payment
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION sync_cash_balance_on_payment();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE accounting_user_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_balances              ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_debts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE amis_sync_queue            ENABLE ROW LEVEL SECURITY;

-- ---- accounting_user_profiles ----
-- Chỉ admin quản lý, user thấy hồ sơ của mình
DROP POLICY IF EXISTS "profiles_select_own" ON accounting_user_profiles;
CREATE POLICY "profiles_select_own" ON accounting_user_profiles
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "profiles_admin_all" ON accounting_user_profiles;
CREATE POLICY "profiles_admin_all" ON accounting_user_profiles
  USING (get_accounting_role() = 'admin');

-- ---- receipts ----
-- thu_ngan: xem + tạo phiếu thu của chi nhánh mình
DROP POLICY IF EXISTS "receipts_thu_ngan_select" ON receipts;
CREATE POLICY "receipts_thu_ngan_select" ON receipts
  FOR SELECT USING (
    get_accounting_role() = 'thu_ngan'
    AND branch_id = get_accounting_branch_id()
  );

DROP POLICY IF EXISTS "receipts_thu_ngan_insert" ON receipts;
CREATE POLICY "receipts_thu_ngan_insert" ON receipts
  FOR INSERT WITH CHECK (
    get_accounting_role() = 'thu_ngan'
    AND branch_id = get_accounting_branch_id()
  );

-- ke_toan_cn: xem chi nhánh mình + không tự tạo
DROP POLICY IF EXISTS "receipts_ke_toan_cn_select" ON receipts;
CREATE POLICY "receipts_ke_toan_cn_select" ON receipts
  FOR SELECT USING (
    get_accounting_role() = 'ke_toan_cn'
    AND branch_id = get_accounting_branch_id()
  );

-- ke_toan_ho + giam_doc + admin: xem tất cả
DROP POLICY IF EXISTS "receipts_ho_select_all" ON receipts;
CREATE POLICY "receipts_ho_select_all" ON receipts
  FOR SELECT USING (
    get_accounting_role() IN ('ke_toan_ho', 'giam_doc', 'admin')
  );

-- ke_toan_ho: có thể void phiếu
DROP POLICY IF EXISTS "receipts_ho_update" ON receipts;
CREATE POLICY "receipts_ho_update" ON receipts
  FOR UPDATE USING (
    get_accounting_role() IN ('ke_toan_ho', 'admin')
  );

-- ---- payments ----
DROP POLICY IF EXISTS "payments_thu_ngan_insert" ON payments;
CREATE POLICY "payments_thu_ngan_insert" ON payments
  FOR INSERT WITH CHECK (
    get_accounting_role() IN ('thu_ngan', 'ke_toan_cn')
    AND branch_id = get_accounting_branch_id()
  );

DROP POLICY IF EXISTS "payments_cn_select" ON payments;
CREATE POLICY "payments_cn_select" ON payments
  FOR SELECT USING (
    get_accounting_role() IN ('thu_ngan', 'ke_toan_cn')
    AND branch_id = get_accounting_branch_id()
  );

DROP POLICY IF EXISTS "payments_ho_select_all" ON payments;
CREATE POLICY "payments_ho_select_all" ON payments
  FOR SELECT USING (
    get_accounting_role() IN ('ke_toan_ho', 'giam_doc', 'admin')
  );

-- ke_toan_cn duyệt phiếu chi của chi nhánh; ke_toan_ho duyệt tất cả
DROP POLICY IF EXISTS "payments_approve" ON payments;
CREATE POLICY "payments_approve" ON payments
  FOR UPDATE USING (
    (get_accounting_role() = 'ke_toan_cn' AND branch_id = get_accounting_branch_id())
    OR get_accounting_role() IN ('ke_toan_ho', 'admin')
  );

-- ---- cash_balances ----
DROP POLICY IF EXISTS "cash_cn_select" ON cash_balances;
CREATE POLICY "cash_cn_select" ON cash_balances
  FOR SELECT USING (
    get_accounting_role() IN ('thu_ngan', 'ke_toan_cn')
    AND branch_id = get_accounting_branch_id()
  );

DROP POLICY IF EXISTS "cash_ho_select_all" ON cash_balances;
CREATE POLICY "cash_ho_select_all" ON cash_balances
  FOR SELECT USING (
    get_accounting_role() IN ('ke_toan_ho', 'giam_doc', 'admin')
  );

-- Chỉ ke_toan_cn/ke_toan_ho/admin mới được đóng ngày (cập nhật actual_cash)
DROP POLICY IF EXISTS "cash_close_day" ON cash_balances;
CREATE POLICY "cash_close_day" ON cash_balances
  FOR UPDATE USING (
    (get_accounting_role() = 'ke_toan_cn' AND branch_id = get_accounting_branch_id())
    OR get_accounting_role() IN ('ke_toan_ho', 'admin')
  );

-- ---- customer_debts ----
DROP POLICY IF EXISTS "debts_cn_select" ON customer_debts;
CREATE POLICY "debts_cn_select" ON customer_debts
  FOR SELECT USING (
    get_accounting_role() IN ('thu_ngan', 'ke_toan_cn')
    AND branch_id = get_accounting_branch_id()
  );

DROP POLICY IF EXISTS "debts_cn_insert" ON customer_debts;
CREATE POLICY "debts_cn_insert" ON customer_debts
  FOR INSERT WITH CHECK (
    get_accounting_role() IN ('thu_ngan', 'ke_toan_cn')
    AND branch_id = get_accounting_branch_id()
  );

DROP POLICY IF EXISTS "debts_ho_all" ON customer_debts;
CREATE POLICY "debts_ho_all" ON customer_debts
  USING (get_accounting_role() IN ('ke_toan_ho', 'giam_doc', 'admin'));

-- ---- unmatched_transactions ----
-- thu_ngan không thấy unmatched; ke_toan trở lên mới xử lý
DROP POLICY IF EXISTS "unmatched_ke_toan_select" ON unmatched_transactions;
CREATE POLICY "unmatched_ke_toan_select" ON unmatched_transactions
  FOR SELECT USING (
    get_accounting_role() IN ('ke_toan_cn', 'ke_toan_ho', 'giam_doc', 'admin')
  );

DROP POLICY IF EXISTS "unmatched_ho_resolve" ON unmatched_transactions;
CREATE POLICY "unmatched_ho_resolve" ON unmatched_transactions
  FOR UPDATE USING (
    get_accounting_role() IN ('ke_toan_ho', 'admin')
  );

-- ---- amis_sync_queue ----
-- Chỉ ke_toan_ho và admin xem queue
DROP POLICY IF EXISTS "amis_queue_ho_select" ON amis_sync_queue;
CREATE POLICY "amis_queue_ho_select" ON amis_sync_queue
  FOR SELECT USING (
    get_accounting_role() IN ('ke_toan_ho', 'admin')
  );

DROP POLICY IF EXISTS "amis_queue_ho_update" ON amis_sync_queue;
CREATE POLICY "amis_queue_ho_update" ON amis_sync_queue
  FOR UPDATE USING (
    get_accounting_role() IN ('ke_toan_ho', 'admin')
  );

-- ============================================================
-- pg_cron: lên lịch Edge Function chạy tự động
-- ⚠️  KHÔNG chạy block này trong migration chính.
--     Xem file: supabase/migrations/20260330000099_cron_jobs.sql
--     Chạy RIÊNG sau khi đã bật pg_cron trong Supabase Dashboard.
-- ============================================================

-- ============================================================
-- Realtime: bật cho màn hình thu tiền lắng nghe
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE receipts;
ALTER PUBLICATION supabase_realtime ADD TABLE cash_balances;
ALTER PUBLICATION supabase_realtime ADD TABLE unmatched_transactions;
