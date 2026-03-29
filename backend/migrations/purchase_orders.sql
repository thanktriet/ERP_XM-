-- ═══════════════════════════════════════════════════════════════════════════════
-- MODULE ĐƠN NHẬP HÀNG (Purchase Orders)
-- ERP Xe Máy Điện · Supabase / PostgreSQL
-- ───────────────────────────────────────────────────────────────────────────────
-- CHẠY SAU: schema.sql và accounting.sql đã chạy thành công
-- ───────────────────────────────────────────────────────────────────────────────
-- NGHIỆP VỤ BAO GỒM:
--   Đặt hàng NCC → Duyệt PO → NCC giao xe → Kiểm hàng nhập kho
--   → Hoá đơn mua vào → Thanh toán NCC → Bút toán kế toán tự động
--
-- LUỒNG TRẠNG THÁI:
--   draft → submitted → approved → partial_received → fully_received
--         ↘ rejected                                ↘ invoiced → paid
--           cancelled (từ draft/submitted)
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- BẢNG 1: purchase_orders — Đầu phiếu đơn đặt mua xe
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Mã đơn: "PO2026030001" — tự sinh qua trigger
  po_number         TEXT          NOT NULL UNIQUE,

  -- Chi nhánh đặt hàng (dùng acc_branches nếu đã chạy accounting.sql)
  branch_id         UUID          REFERENCES acc_branches(id) ON DELETE RESTRICT,

  -- Nhà cung cấp (bắt buộc)
  supplier_id       UUID          NOT NULL REFERENCES acc_suppliers(id) ON DELETE RESTRICT,

  -- Ngày tháng
  order_date        DATE          NOT NULL DEFAULT CURRENT_DATE,
  expected_date     DATE,                         -- Ngày hẹn giao dự kiến
  actual_date       DATE,                         -- Ngày NCC giao thực tế

  -- ── Trạng thái đơn hàng ───────────────────────────────────────────────────
  -- draft          : Đang soạn, chưa gửi NCC
  -- submitted      : Đã gửi NCC, chờ xác nhận
  -- approved       : NCC xác nhận, chờ nhận hàng
  -- partial_received: Nhận một phần (NCC giao nhiều đợt)
  -- fully_received : Nhận đủ toàn bộ xe
  -- invoiced       : Đã có hoá đơn VAT từ NCC
  -- paid           : Đã thanh toán đủ
  -- rejected       : NCC từ chối / điều khoản không đạt
  -- cancelled      : Huỷ đơn (chỉ từ draft/submitted)
  status            TEXT          NOT NULL DEFAULT 'draft'
                    CHECK (status IN (
                      'draft', 'submitted', 'approved',
                      'partial_received', 'fully_received',
                      'invoiced', 'paid',
                      'rejected', 'cancelled'
                    )),

  -- ── Tài chính ─────────────────────────────────────────────────────────────
  subtotal          NUMERIC(18,0) NOT NULL DEFAULT 0,   -- Tổng chưa thuế
  vat_amount        NUMERIC(18,0) NOT NULL DEFAULT 0,   -- Thuế GTGT đầu vào
  total_amount      NUMERIC(18,0) NOT NULL DEFAULT 0,   -- Tổng phải trả (= subtotal + vat)
  paid_amount       NUMERIC(18,0) NOT NULL DEFAULT 0,   -- Đã thanh toán
  -- Computed: còn lại bao nhiêu chưa trả
  balance_due       NUMERIC(18,0) GENERATED ALWAYS AS
                    (total_amount - paid_amount) STORED,

  -- Điều khoản thanh toán (override từ supplier.payment_terms nếu cần)
  payment_terms     SMALLINT      DEFAULT 30,            -- Số ngày được nợ
  payment_due_date  DATE,                               -- Hạn thanh toán cuối

  -- Phương thức thanh toán
  payment_method    TEXT          CHECK (payment_method IN
                    ('cash', 'bank_transfer', 'check', 'mixed')),

  -- ── Hoá đơn NCC ──────────────────────────────────────────────────────────
  -- Sau khi nhận hàng, NCC xuất HĐ GTGT
  supplier_invoice_number TEXT,                         -- Số HĐ NCC (ký hiệu + số)
  supplier_invoice_date   DATE,
  supplier_invoice_url    TEXT,                         -- URL scan HĐ lên Storage

  -- ── Kế toán ───────────────────────────────────────────────────────────────
  -- acc_voucher_id tự điền khi controller tạo bút toán nhập hàng
  acc_voucher_id    UUID          REFERENCES acc_vouchers(id) ON DELETE SET NULL,

  -- ── Thông tin thêm ────────────────────────────────────────────────────────
  warehouse_note    TEXT,                               -- Ghi chú nhập kho
  notes             TEXT,                               -- Ghi chú nội bộ
  cancel_reason     TEXT,

  -- ── Người thực hiện ───────────────────────────────────────────────────────
  created_by        UUID          REFERENCES users(id)  ON DELETE SET NULL,
  submitted_by      UUID          REFERENCES users(id)  ON DELETE SET NULL,
  approved_by       UUID          REFERENCES users(id)  ON DELETE SET NULL,
  received_by       UUID          REFERENCES users(id)  ON DELETE SET NULL,

  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Không cho sửa đơn sau khi đã được duyệt nhận hàng
  CONSTRAINT chk_po_paid_lte_total CHECK (paid_amount <= total_amount)
);

COMMENT ON TABLE purchase_orders IS
  'Đơn đặt mua xe từ nhà phân phối / nhà cung cấp. '
  'Khi status = fully_received: trigger tự tạo acc_voucher (PKN - nhập kho) '
  'và cập nhật inventory_vehicles. '
  'Khi status = invoiced: tạo acc_voucher (HDM - hoá đơn mua vào).';

CREATE INDEX IF NOT EXISTS idx_po_supplier    ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_branch      ON purchase_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_po_status      ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_date        ON purchase_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_po_due         ON purchase_orders(payment_due_date)
  WHERE status NOT IN ('paid','cancelled','rejected');


-- ─────────────────────────────────────────────────────────────────────────────
-- BẢNG 2: purchase_order_items — Chi tiết từng dòng xe đặt mua
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id                 UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_number           SMALLINT      NOT NULL DEFAULT 1,

  -- Dòng xe cần mua
  vehicle_model_id      UUID          NOT NULL REFERENCES vehicle_models(id) ON DELETE RESTRICT,
  color                 TEXT,                           -- Màu sắc đặt
  year_manufacture      SMALLINT,

  -- Số lượng
  qty_ordered           INT           NOT NULL CHECK (qty_ordered > 0),   -- Số lượng đặt
  qty_received          INT           NOT NULL DEFAULT 0                   -- Số lượng đã nhận
                        CHECK (qty_received >= 0),
  qty_rejected          INT           NOT NULL DEFAULT 0                   -- Số lượng từ chối (lỗi, sai model)
                        CHECK (qty_rejected >= 0),
  -- qty_pending = qty_ordered - qty_received - qty_rejected (computed)
  qty_pending           INT           GENERATED ALWAYS AS
                        (qty_ordered - qty_received - qty_rejected) STORED,

  -- Giá
  unit_cost             NUMERIC(18,0) NOT NULL CHECK (unit_cost > 0),     -- Giá nhập chưa VAT / xe
  vat_rate              NUMERIC(5,2)  NOT NULL DEFAULT 10.00,              -- % VAT (10%)
  vat_amount            NUMERIC(18,0) GENERATED ALWAYS AS
                        (ROUND(unit_cost * qty_ordered * vat_rate / 100)) STORED,
  line_total            NUMERIC(18,0) GENERATED ALWAYS AS
                        (unit_cost * qty_ordered) STORED,                 -- Chưa VAT
  line_total_with_vat   NUMERIC(18,0) GENERATED ALWAYS AS
                        (ROUND(unit_cost * qty_ordered * (1 + vat_rate / 100))) STORED,

  notes                 TEXT,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE (po_id, line_number),
  CONSTRAINT chk_received_lte_ordered CHECK (qty_received + qty_rejected <= qty_ordered)
);

COMMENT ON TABLE purchase_order_items IS
  'Từng dòng xe trong đơn đặt mua. '
  'qty_pending = số xe chưa giao — dùng để theo dõi NCC giao từng đợt. '
  'qty_rejected = xe bị trả lại (sai model, lỗi kỹ thuật).';

CREATE INDEX IF NOT EXISTS idx_poi_po           ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_poi_model        ON purchase_order_items(vehicle_model_id);
CREATE INDEX IF NOT EXISTS idx_poi_pending      ON purchase_order_items(qty_pending)
  WHERE qty_pending > 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- BẢNG 3: purchase_receipts — Phiếu nhận hàng (mỗi lần NCC giao = 1 phiếu)
-- NCC có thể giao nhiều đợt → nhiều receipt cho 1 PO
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_receipts (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id             UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,

  -- Số phiếu nhận: "PKN2026030001"
  receipt_number    TEXT          NOT NULL UNIQUE,
  receipt_date      DATE          NOT NULL DEFAULT CURRENT_DATE,

  -- Trạng thái kiểm hàng
  -- pending   : Chờ kiểm tra
  -- inspecting: Đang kiểm tra chất lượng
  -- accepted  : Đã chấp nhận, nhập kho
  -- rejected  : Từ chối toàn bộ lô (trả NCC)
  status            TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','inspecting','accepted','rejected')),

  -- Người nhận và kiểm hàng
  received_by       UUID          REFERENCES users(id) ON DELETE SET NULL,
  inspected_by      UUID          REFERENCES users(id) ON DELETE SET NULL,
  inspection_notes  TEXT,

  -- Kế toán: acc_voucher_id sau khi nhập kho
  acc_voucher_id    UUID          REFERENCES acc_vouchers(id) ON DELETE SET NULL,

  notes             TEXT,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE purchase_receipts IS
  'Phiếu nhận hàng từng đợt giao của NCC. '
  '1 PO có thể có nhiều receipt (giao đợt). '
  'Khi status = accepted: trigger tự tạo inventory_vehicles '
  'và cập nhật purchase_order_items.qty_received.';

CREATE INDEX IF NOT EXISTS idx_pr_po     ON purchase_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_pr_date   ON purchase_receipts(receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_pr_status ON purchase_receipts(status);


-- ─────────────────────────────────────────────────────────────────────────────
-- BẢNG 4: purchase_receipt_items — Chi tiết từng xe trong phiếu nhận hàng
-- Mỗi xe nhận vào → 1 dòng → gắn với inventory_vehicles sau khi accepted
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id                    UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  receipt_id            UUID          NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  po_item_id            UUID          NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  line_number           SMALLINT      NOT NULL DEFAULT 1,

  -- Thông tin xe thực nhận (điền khi xe đến)
  vin                   TEXT,                           -- Số khung (scan từ xe)
  engine_number         TEXT,                           -- Số máy / motor
  battery_serial        TEXT,                           -- Số serial pin
  color                 TEXT,
  year_manufacture      SMALLINT,

  -- Kết quả kiểm hàng
  -- ok       : Xe đạt chất lượng, nhập kho
  -- defect   : Lỗi nhẹ, chấp nhận nhập kho nhưng ghi chú
  -- rejected : Lỗi nặng / sai model, trả NCC
  condition             TEXT          NOT NULL DEFAULT 'ok'
                        CHECK (condition IN ('ok','defect','rejected')),
  defect_notes          TEXT,                           -- Mô tả lỗi nếu defect/rejected

  -- Sau khi accepted: gắn với bản ghi inventory_vehicles
  inventory_vehicle_id  UUID          REFERENCES inventory_vehicles(id) ON DELETE SET NULL,

  -- Giá nhập thực tế (có thể khác PO nếu NCC điều chỉnh)
  actual_unit_cost      NUMERIC(18,0),

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (receipt_id, line_number)
);

COMMENT ON TABLE purchase_receipt_items IS
  'Chi tiết từng xe trong phiếu nhận hàng. '
  'Sau khi accepted: inventory_vehicle_id được gắn vào bản ghi xe trong kho. '
  'vin, engine_number, battery_serial điền khi scan xe thực tế.';

CREATE INDEX IF NOT EXISTS idx_pri_receipt ON purchase_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_pri_po_item ON purchase_receipt_items(po_item_id);
CREATE INDEX IF NOT EXISTS idx_pri_vehicle ON purchase_receipt_items(inventory_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pri_vin     ON purchase_receipt_items(vin) WHERE vin IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- BẢNG 5: po_payments — Lịch sử thanh toán cho NCC
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS po_payments (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_id             UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,

  payment_number    TEXT          NOT NULL UNIQUE,      -- "TTNCC2026030001"
  payment_date      DATE          NOT NULL DEFAULT CURRENT_DATE,
  amount            NUMERIC(18,0) NOT NULL CHECK (amount > 0),
  payment_method    TEXT          NOT NULL
                    CHECK (payment_method IN ('cash','bank_transfer','check')),
  bank_reference    TEXT,                               -- Số tham chiếu chuyển khoản
  note              TEXT,

  -- Kế toán: phiếu chi tương ứng
  acc_voucher_id    UUID          REFERENCES acc_vouchers(id) ON DELETE SET NULL,

  created_by        UUID          REFERENCES users(id)  ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE po_payments IS
  'Từng lần thanh toán cho NCC (1 PO có thể trả nhiều đợt). '
  'acc_voucher_id trỏ tới Phiếu chi (PC) đã tạo bên kế toán.';

CREATE INDEX IF NOT EXISTS idx_pop_po   ON po_payments(po_id);
CREATE INDEX IF NOT EXISTS idx_pop_date ON po_payments(payment_date DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Trigger 1: Tự sinh po_number ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_generate_po_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_year  TEXT;
  v_month TEXT;
  v_seq   INT;
BEGIN
  v_year  := TO_CHAR(NOW(), 'YYYY');
  v_month := TO_CHAR(NOW(), 'MM');

  SELECT COUNT(*) + 1 INTO v_seq
  FROM   purchase_orders
  WHERE  po_number LIKE 'PO' || v_year || v_month || '%';

  NEW.po_number := 'PO' || v_year || v_month || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_number ON purchase_orders;
CREATE TRIGGER trg_po_number
  BEFORE INSERT ON purchase_orders
  FOR EACH ROW
  WHEN (NEW.po_number IS NULL OR NEW.po_number = '')
  EXECUTE FUNCTION fn_generate_po_number();


-- ─── Trigger 2: Tự sinh receipt_number ───────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_generate_receipt_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_seq
  FROM   purchase_receipts
  WHERE  receipt_number LIKE 'PKN' || TO_CHAR(NOW(), 'YYYYMM') || '%';

  NEW.receipt_number := 'PKN' || TO_CHAR(NOW(), 'YYYYMM') || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_number ON purchase_receipts;
CREATE TRIGGER trg_receipt_number
  BEFORE INSERT ON purchase_receipts
  FOR EACH ROW
  WHEN (NEW.receipt_number IS NULL OR NEW.receipt_number = '')
  EXECUTE FUNCTION fn_generate_receipt_number();


-- ─── Trigger 3: Tự sinh payment_number ───────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_generate_po_payment_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_seq INT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_seq
  FROM   po_payments
  WHERE  payment_number LIKE 'TTNCC' || TO_CHAR(NOW(), 'YYYYMM') || '%';

  NEW.payment_number := 'TTNCC' || TO_CHAR(NOW(), 'YYYYMM') || LPAD(v_seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_payment_number ON po_payments;
CREATE TRIGGER trg_po_payment_number
  BEFORE INSERT ON po_payments
  FOR EACH ROW
  WHEN (NEW.payment_number IS NULL OR NEW.payment_number = '')
  EXECUTE FUNCTION fn_generate_po_payment_number();


-- ─── Trigger 4: Khi receipt accepted → tạo inventory_vehicles + cập nhật PO ─
CREATE OR REPLACE FUNCTION fn_receipt_accepted()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_item          RECORD;
  v_vehicle_id    UUID;
  v_po            RECORD;
  v_total_ordered INT;
  v_total_received INT;
BEGIN
  -- Chỉ xử lý khi chuyển sang accepted
  IF NOT (NEW.status = 'accepted' AND OLD.status != 'accepted') THEN
    RETURN NEW;
  END IF;

  -- Duyệt từng xe trong phiếu nhận
  FOR v_item IN
    SELECT pri.*, poi.vehicle_model_id, poi.unit_cost, po.branch_id
    FROM   purchase_receipt_items pri
    JOIN   purchase_order_items   poi ON poi.id = pri.po_item_id
    JOIN   purchase_orders        po  ON po.id  = NEW.po_id
    WHERE  pri.receipt_id = NEW.id
      AND  pri.condition  IN ('ok','defect')   -- Bỏ qua xe bị rejected
  LOOP
    -- Tạo bản ghi kho cho từng xe (nếu chưa có)
    IF v_item.inventory_vehicle_id IS NULL THEN
      INSERT INTO inventory_vehicles
        (vehicle_model_id, vin, engine_number, battery_serial, color,
         year_manufacture, status, import_date,
         import_price, notes)
      VALUES
        (v_item.vehicle_model_id,
         v_item.vin,
         v_item.engine_number,
         v_item.battery_serial,
         v_item.color,
         v_item.year_manufacture,
         'in_stock',
         NEW.receipt_date,
         COALESCE(v_item.actual_unit_cost, v_item.unit_cost),
         CASE v_item.condition WHEN 'defect'
           THEN 'Nhập kho có lỗi: ' || COALESCE(v_item.defect_notes, '')
           ELSE NULL END)
      RETURNING id INTO v_vehicle_id;

      -- Gắn inventory_vehicle_id vào receipt item
      UPDATE purchase_receipt_items
      SET    inventory_vehicle_id = v_vehicle_id
      WHERE  id = v_item.id;
    END IF;

    -- Tăng qty_received trên PO item
    UPDATE purchase_order_items
    SET    qty_received = qty_received + 1
    WHERE  id = v_item.po_item_id;

    -- Tăng qty_rejected nếu condition = rejected (xe bị trả)
    IF v_item.condition = 'rejected' THEN
      UPDATE purchase_order_items
      SET    qty_rejected = qty_rejected + 1
      WHERE  id = v_item.po_item_id;
    END IF;
  END LOOP;

  -- Kiểm tra PO đã nhận đủ chưa → cập nhật status PO
  SELECT SUM(qty_ordered), SUM(qty_received)
  INTO   v_total_ordered, v_total_received
  FROM   purchase_order_items
  WHERE  po_id = NEW.po_id;

  IF v_total_received >= v_total_ordered THEN
    UPDATE purchase_orders
    SET    status      = 'fully_received',
           actual_date = NEW.receipt_date
    WHERE  id = NEW.po_id AND status NOT IN ('invoiced','paid','cancelled');
  ELSIF v_total_received > 0 THEN
    UPDATE purchase_orders
    SET    status = 'partial_received'
    WHERE  id = NEW.po_id AND status = 'approved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipt_accepted ON purchase_receipts;
CREATE TRIGGER trg_receipt_accepted
  AFTER UPDATE ON purchase_receipts
  FOR EACH ROW EXECUTE FUNCTION fn_receipt_accepted();


-- ─── Trigger 5: Cập nhật paid_amount khi có payment mới ──────────────────────
CREATE OR REPLACE FUNCTION fn_update_po_paid_amount()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE v_total NUMERIC(18,0);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total
  FROM   po_payments
  WHERE  po_id = COALESCE(NEW.po_id, OLD.po_id);

  UPDATE purchase_orders
  SET    paid_amount = v_total,
         status = CASE
           WHEN v_total >= total_amount
            AND status = 'invoiced' THEN 'paid'
           ELSE status
         END
  WHERE  id = COALESCE(NEW.po_id, OLD.po_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_po_paid_amount ON po_payments;
CREATE TRIGGER trg_po_paid_amount
  AFTER INSERT OR UPDATE OR DELETE ON po_payments
  FOR EACH ROW EXECUTE FUNCTION fn_update_po_paid_amount();


-- ─── Trigger 6: Tự cập nhật subtotal/vat/total khi sửa PO items ─────────────
CREATE OR REPLACE FUNCTION fn_update_po_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE purchase_orders po
  SET
    subtotal     = (SELECT COALESCE(SUM(line_total),           0) FROM purchase_order_items WHERE po_id = COALESCE(NEW.po_id, OLD.po_id)),
    vat_amount   = (SELECT COALESCE(SUM(vat_amount),           0) FROM purchase_order_items WHERE po_id = COALESCE(NEW.po_id, OLD.po_id)),
    total_amount = (SELECT COALESCE(SUM(line_total_with_vat),  0) FROM purchase_order_items WHERE po_id = COALESCE(NEW.po_id, OLD.po_id))
  WHERE po.id = COALESCE(NEW.po_id, OLD.po_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_po_totals ON purchase_order_items;
CREATE TRIGGER trg_po_totals
  AFTER INSERT OR UPDATE OR DELETE ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION fn_update_po_totals();


-- ─── Trigger 7: Cấm sửa PO đã được approved trở lên ─────────────────────────
CREATE OR REPLACE FUNCTION fn_protect_approved_po()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('approved','partial_received','fully_received','invoiced','paid') THEN
    -- Chỉ cho phép cập nhật các cột vận hành (không cho sửa items giá, số lượng)
    IF OLD.supplier_id    != NEW.supplier_id OR
       OLD.total_amount   != NEW.total_amount THEN
      RAISE EXCEPTION
        '[Kiểm soát PO] Đơn hàng % đã được duyệt (status=%). '
        'Không thể thay đổi NCC hoặc tổng tiền. '
        'Hủy đơn cũ và tạo đơn mới nếu cần.',
        OLD.po_number, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_approved_po ON purchase_orders;
CREATE TRIGGER trg_protect_approved_po
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION fn_protect_approved_po();


-- ─── Trigger 8: updated_at ───────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders','purchase_receipts']
  LOOP
    EXECUTE FORMAT(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
       CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at();',
      t, t
    );
  END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE purchase_orders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_payments            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "po_rls"         ON purchase_orders;
DROP POLICY IF EXISTS "poi_rls"        ON purchase_order_items;
DROP POLICY IF EXISTS "pr_rls"         ON purchase_receipts;
DROP POLICY IF EXISTS "pri_rls"        ON purchase_receipt_items;
DROP POLICY IF EXISTS "pop_rls"        ON po_payments;

-- admin / manager / accountant / warehouse thấy tất cả
-- sales chỉ xem, không có quyền tạo PO
CREATE POLICY "po_rls" ON purchase_orders
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant','warehouse')
    OR (fn_user_role() = 'sales' AND current_setting('request.method', TRUE) = 'GET')
  );

CREATE POLICY "poi_rls" ON purchase_order_items
  FOR ALL USING (
    po_id IN (SELECT id FROM purchase_orders)
  );

CREATE POLICY "pr_rls" ON purchase_receipts
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant','warehouse')
  );

CREATE POLICY "pri_rls" ON purchase_receipt_items
  FOR ALL USING (
    receipt_id IN (SELECT id FROM purchase_receipts)
  );

CREATE POLICY "pop_rls" ON po_payments
  FOR ALL USING (
    fn_user_role() IN ('admin','manager','accountant')
  );


-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Dashboard: PO đang chờ xử lý (cần action)
CREATE OR REPLACE VIEW v_po_action_required AS
SELECT
  po.id,
  po.po_number,
  s.supplier_name,
  b.branch_name,
  po.status,
  po.order_date,
  po.expected_date,
  po.total_amount,
  po.paid_amount,
  po.balance_due,
  po.payment_due_date,
  -- Cờ cần action
  CASE po.status
    WHEN 'draft'             THEN 'Chờ gửi NCC'
    WHEN 'submitted'         THEN 'Chờ NCC xác nhận'
    WHEN 'approved'          THEN 'Chờ nhận hàng'
    WHEN 'partial_received'  THEN 'Còn hàng chưa về'
    WHEN 'fully_received'    THEN 'Chờ hoá đơn NCC'
    WHEN 'invoiced'          THEN 'Chờ thanh toán'
  END                                 AS action_label,
  -- Cảnh báo quá hạn
  CASE
    WHEN po.payment_due_date < CURRENT_DATE
     AND po.status = 'invoiced'       THEN TRUE
    ELSE FALSE
  END                                 AS is_overdue,
  -- Tóm tắt xe còn thiếu
  (SELECT SUM(qty_pending)
   FROM   purchase_order_items
   WHERE  po_id = po.id)              AS total_pending_vehicles
FROM       purchase_orders    po
JOIN       acc_suppliers      s  ON s.id = po.supplier_id
LEFT JOIN  acc_branches       b  ON b.id = po.branch_id
WHERE      po.status NOT IN ('paid','cancelled','rejected')
ORDER BY
  CASE po.status
    WHEN 'invoiced'         THEN 1
    WHEN 'fully_received'   THEN 2
    WHEN 'partial_received' THEN 3
    WHEN 'approved'         THEN 4
    WHEN 'submitted'        THEN 5
    WHEN 'draft'            THEN 6
  END,
  po.order_date;


-- Tổng hợp nhập hàng theo tháng
CREATE OR REPLACE VIEW v_po_monthly_summary AS
SELECT
  DATE_TRUNC('month', po.order_date)::DATE          AS month,
  COUNT(DISTINCT po.id)                             AS total_pos,
  COUNT(DISTINCT po.supplier_id)                    AS total_suppliers,
  SUM(poi.qty_ordered)                              AS total_ordered,
  SUM(poi.qty_received)                             AS total_received,
  SUM(po.total_amount)                              AS total_value,
  SUM(po.paid_amount)                               AS total_paid,
  SUM(po.balance_due)                               AS total_outstanding
FROM       purchase_orders      po
JOIN       purchase_order_items poi ON poi.po_id = po.id
WHERE      po.status NOT IN ('cancelled','rejected')
GROUP BY   DATE_TRUNC('month', po.order_date)
ORDER BY   month DESC;


-- ═══════════════════════════════════════════════════════════════════════════════
-- KIỂM TRA
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM   information_schema.tables
  WHERE  table_schema = 'public'
    AND  table_name IN (
      'purchase_orders','purchase_order_items',
      'purchase_receipts','purchase_receipt_items',
      'po_payments'
    );

  IF v_count = 5 THEN
    RAISE NOTICE '══════════════════════════════════════════════';
    RAISE NOTICE '  Module Đơn nhập hàng — Khởi tạo thành công';
    RAISE NOTICE '  ✓ 5 bảng đã tạo';
    RAISE NOTICE '  ✓ 8 triggers bảo vệ nghiệp vụ';
    RAISE NOTICE '  ✓ 2 views dashboard';
    RAISE NOTICE '  ✓ RLS theo role';
    RAISE NOTICE '══════════════════════════════════════════════';
    RAISE NOTICE '  LUỒNG SỬ DỤNG:';
    RAISE NOTICE '  1. Tạo purchase_order (draft)';
    RAISE NOTICE '  2. Thêm purchase_order_items (từng model xe)';
    RAISE NOTICE '  3. Submit → Approved (NCC xác nhận)';
    RAISE NOTICE '  4. Tạo purchase_receipt khi xe về';
    RAISE NOTICE '  5. Thêm purchase_receipt_items (scan VIN)';
    RAISE NOTICE '  6. Accept receipt → tự tạo inventory_vehicles';
    RAISE NOTICE '  7. Nhận HĐ NCC → status = invoiced';
    RAISE NOTICE '  8. Thanh toán qua po_payments → status = paid';
    RAISE NOTICE '══════════════════════════════════════════════';
  ELSE
    RAISE WARNING 'Chỉ tạo được % / 5 bảng — kiểm tra lại lỗi phía trên!', v_count;
  END IF;
END;
$$;

COMMIT;
