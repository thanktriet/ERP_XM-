-- ============================================================
-- Migration: Bổ sung 2 bảng còn thiếu cho module kế toán
-- Chạy trong Supabase SQL Editor
--
-- Bảng đã có (KHÔNG tạo lại):
--   acc_vouchers         → thay thế receipts + payments
--   acc_sync_queue       → thay thế amis_sync_queue
--   acc_ar_ledger        → thay thế customer_debts
--   acc_period_balances  → thay thế cash_balances
--   acc_branches         → thay thế branches
--
-- Bảng CẦN tạo mới:
--   notifications            (chưa có)
--   accounting_user_profiles (chưa có — mở rộng users.role với metadata kế toán)
-- ============================================================

-- ============================================================
-- 0. Helper functions cho RLS (alias để dùng trong cả 2 file)
-- get_accounting_role()     → đọc acc_role từ accounting_user_profiles
-- get_accounting_branch_id()→ đọc default_branch_id
-- fn_user_role() / fn_user_branch_id() → alias ngắn gọn hơn
-- ============================================================
CREATE OR REPLACE FUNCTION fn_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT acc_role FROM accounting_user_profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION fn_user_branch_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT default_branch_id FROM accounting_user_profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- 1. notifications
-- Thông báo realtime: thanh toán về, chênh lệch sổ sách, sync AMIS xong...
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id       UUID        NOT NULL REFERENCES acc_organizations(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL,
                           -- 'payment_received'  → SEPay webhook matched
                           -- 'payment_unmatched' → không khớp đơn
                           -- 'amis_sync_done'    → batch sync xong
                           -- 'amis_sync_failed'  → item sync thất bại
                           -- 'close_day_ok'      → đóng ngày thành công
                           -- 'close_day_mismatch'→ chênh lệch sổ sách
  title        TEXT        NOT NULL,
  message      TEXT        NOT NULL,
  severity     TEXT        NOT NULL DEFAULT 'info'
                           CHECK (severity IN ('info', 'warning', 'error', 'success')),
  -- Điều hướng khi click
  link_path    TEXT,                           -- nullable, ví dụ: '/payment/uuid-123'
  link_label   TEXT,                           -- nullable, ví dụ: 'Xem phiếu thu'
  -- Liên kết với đối tượng nguồn (soft FK)
  reference_type TEXT,                         -- nullable, 'acc_voucher' | 'acc_sync_queue' | ...
  reference_id   UUID,                         -- nullable
  -- Phạm vi hiển thị
  branch_id    UUID        REFERENCES acc_branches(id) ON DELETE SET NULL, -- nullable = tất cả CN
  target_roles TEXT[]      NOT NULL DEFAULT '{}',
                           -- ['admin','accountant'] — ai được thấy thông báo này
  -- Trạng thái đọc (lưu per-user trong notification_reads)
  is_global    BOOLEAN     NOT NULL DEFAULT FALSE,
                           -- TRUE = gửi cho tất cả user khớp target_roles, FALSE = cá nhân
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ               -- nullable, sau thời điểm này tự ẩn
);

-- Bảng tracking ai đã đọc thông báo nào
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, user_id)
);

-- Index cho query "thông báo chưa đọc của user X"
CREATE INDEX IF NOT EXISTS idx_notifications_org      ON notifications(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_branch   ON notifications(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_ref      ON notifications(reference_type, reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_expires  ON notifications(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id, read_at DESC);

-- RLS: user chỉ thấy notification của org mình, đúng role, đúng branch
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (
    -- Đúng org
    org_id = (SELECT acc_branches.org_id FROM acc_branches
              WHERE acc_branches.id = fn_user_branch_id() LIMIT 1)
    AND (
      -- Không giới hạn branch = toàn org thấy
      branch_id IS NULL
      -- Hoặc đúng branch mình
      OR branch_id = fn_user_branch_id()
      -- Admin/manager thấy hết
      OR fn_user_role() IN ('admin', 'manager')
    )
    AND (
      -- target_roles rỗng = tất cả thấy
      array_length(target_roles, 1) IS NULL
      OR fn_user_role() = ANY(target_roles)
    )
    AND (expires_at IS NULL OR expires_at > NOW())
  );

-- Chỉ service role (Edge Function) được INSERT
DROP POLICY IF EXISTS "notifications_insert_service" ON notifications;
CREATE POLICY "notifications_insert_service" ON notifications
  FOR INSERT WITH CHECK (TRUE);  -- service_role bypass RLS, anon/user không tạo được trực tiếp

ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_reads_own" ON notification_reads;
CREATE POLICY "notification_reads_own" ON notification_reads
  FOR ALL USING (user_id = auth.uid());


-- ============================================================
-- 2. accounting_user_profiles
-- Mở rộng metadata kế toán cho users (không replace users.role)
-- Dùng để lưu: đơn vị mặc định, cài đặt hiển thị, quyền kế toán bổ sung
-- ============================================================

-- Xóa bảng cũ (schema không tương thích: version cũ references auth.users, version mới references users)
DROP TABLE IF EXISTS accounting_user_profiles CASCADE;

CREATE TABLE IF NOT EXISTS accounting_user_profiles (
  id            UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Quyền kế toán (phân biệt với users.role chung)
  acc_role      TEXT        NOT NULL DEFAULT 'viewer'
                            CHECK (acc_role IN (
                              'viewer',        -- Chỉ xem báo cáo
                              'cashier',       -- Thu tiền, tạo phiếu thu
                              'accountant_cn', -- Kế toán chi nhánh: xem+tạo+sửa phiếu
                              'accountant_ho', -- Kế toán tổng hợp: xem tất cả CN
                              'chief_accountant' -- Kế toán trưởng: duyệt + đóng kỳ
                            )),
  -- Chi nhánh mặc định khi mở màn hình kế toán
  default_branch_id UUID    REFERENCES acc_branches(id) ON DELETE SET NULL, -- nullable
  -- Tổ chức mặc định (nếu sau này multi-org)
  default_org_id    UUID    REFERENCES acc_organizations(id) ON DELETE SET NULL, -- nullable
  -- Cài đặt giao diện
  preferences  JSONB        NOT NULL DEFAULT '{}',
               -- { "date_format": "DD/MM/YYYY", "amount_unit": "vnd", "items_per_page": 20 }
  -- Kỳ kế toán đang làm việc (sticky)
  active_period_id UUID     REFERENCES acc_fiscal_periods(id) ON DELETE SET NULL, -- nullable
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_acc_user_profiles_branch ON accounting_user_profiles(default_branch_id);

-- Trigger updated_at
CREATE TRIGGER trg_acc_user_profiles_updated_at
  BEFORE UPDATE ON accounting_user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: user chỉ đọc/sửa profile của chính mình; admin thấy tất cả
ALTER TABLE accounting_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "acc_user_profiles_own" ON accounting_user_profiles;
CREATE POLICY "acc_user_profiles_own" ON accounting_user_profiles
  FOR ALL USING (id = auth.uid() OR fn_user_role() IN ('admin', 'manager'));


-- ============================================================
-- 3. Seed: Tạo profile kế toán cho tất cả admin hiện có
-- Dùng subquery thay vì UUID cứng — an toàn trên mọi môi trường
-- ============================================================
INSERT INTO accounting_user_profiles (id, acc_role, default_branch_id, default_org_id)
SELECT
  u.id,
  'chief_accountant',
  (SELECT id FROM acc_branches    ORDER BY created_at LIMIT 1),  -- chi nhánh đầu tiên
  (SELECT id FROM acc_organizations ORDER BY created_at LIMIT 1) -- org đầu tiên
FROM users u
WHERE u.role = 'admin'
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 4. Function: upsert_acc_notification()
-- Helper cho Edge Functions: tạo thông báo + tự điền org_id
-- ============================================================
CREATE OR REPLACE FUNCTION upsert_acc_notification(
  p_type          TEXT,
  p_title         TEXT,
  p_message       TEXT,
  p_severity      TEXT        DEFAULT 'info',
  p_branch_id     UUID        DEFAULT NULL,
  p_target_roles  TEXT[]      DEFAULT '{}',
  p_link_path     TEXT        DEFAULT NULL,
  p_reference_type TEXT       DEFAULT NULL,
  p_reference_id  UUID        DEFAULT NULL,
  p_expires_hours INTEGER     DEFAULT NULL   -- NULL = không hết hạn
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id UUID;
  v_notification_id UUID;
BEGIN
  -- Lấy org_id từ branch (nếu có) hoặc dùng org mặc định
  IF p_branch_id IS NOT NULL THEN
    SELECT org_id INTO v_org_id FROM acc_branches WHERE id = p_branch_id;
  END IF;
  -- Fallback: lấy org đầu tiên (single-org system)
  IF v_org_id IS NULL THEN
    SELECT id INTO v_org_id FROM acc_organizations LIMIT 1;
  END IF;

  INSERT INTO notifications (
    org_id, type, title, message, severity,
    branch_id, target_roles, link_path,
    reference_type, reference_id,
    expires_at
  ) VALUES (
    v_org_id, p_type, p_title, p_message, p_severity,
    p_branch_id, p_target_roles, p_link_path,
    p_reference_type, p_reference_id,
    CASE WHEN p_expires_hours IS NOT NULL
         THEN NOW() + (p_expires_hours || ' hours')::INTERVAL
         ELSE NULL
    END
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;

-- ============================================================
-- 5. View: v_unread_notifications
-- Dùng trực tiếp trong frontend qua Supabase SDK
-- ============================================================
CREATE OR REPLACE VIEW v_unread_notifications AS
SELECT
  n.*,
  CASE WHEN nr.user_id IS NOT NULL THEN TRUE ELSE FALSE END AS is_read
FROM notifications n
LEFT JOIN notification_reads nr
  ON nr.notification_id = n.id
  AND nr.user_id = auth.uid()
WHERE
  (n.expires_at IS NULL OR n.expires_at > NOW())
  AND nr.user_id IS NULL; -- chỉ lấy chưa đọc

COMMENT ON VIEW v_unread_notifications IS
  'Thông báo chưa đọc của user hiện tại. RLS của bảng notifications tự lọc theo org/branch/role.';
