const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════════════════════
// DANH SÁCH & CHI TIẾT ĐƠN NHẬP HÀNG
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/purchase-orders
const getPurchaseOrders = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 20);
    const { status, supplier_id, branch_id, from_date, to_date, search } = req.query;

    let q = supabaseAdmin
      .from('purchase_orders')
      .select(`
        id, po_number, status, order_date, expected_date, actual_date,
        subtotal, vat_amount, total_amount, paid_amount, balance_due,
        payment_due_date, supplier_invoice_number, created_at,
        acc_suppliers ( id, supplier_code, supplier_name, phone ),
        acc_branches  ( id, branch_code, branch_name )
      `, { count: 'exact' })
      .order('order_date',  { ascending: false })
      .order('created_at',  { ascending: false });

    if (status)      q = q.eq('status', status);
    if (supplier_id) q = q.eq('supplier_id', supplier_id);
    if (branch_id)   q = q.eq('branch_id', branch_id);
    if (from_date)   q = q.gte('order_date', from_date);
    if (to_date)     q = q.lte('order_date', to_date);
    if (search)      q = q.ilike('po_number', `%${search}%`);

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/action-required — Dashboard: cần xử lý
const getActionRequired = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_po_action_required')
      .select('*');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/:id
const getPurchaseOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const [poRes, itemsRes, receiptsRes, paymentsRes] = await Promise.all([
      supabaseAdmin
        .from('purchase_orders')
        .select(`
          *,
          acc_suppliers ( id, supplier_code, supplier_name, phone, email,
                          tax_code, bank_account, bank_name, payment_terms ),
          acc_branches  ( id, branch_code, branch_name ),
          acc_vouchers  ( id, voucher_number, status )
        `)
        .eq('id', id)
        .single(),

      supabaseAdmin
        .from('purchase_order_items')
        .select(`
          *,
          vehicle_models ( id, brand, model_name, category, price_cost )
        `)
        .eq('po_id', id)
        .order('line_number'),

      supabaseAdmin
        .from('purchase_receipts')
        .select('id, receipt_number, receipt_date, status, received_by')
        .eq('po_id', id)
        .order('receipt_date', { ascending: false }),

      supabaseAdmin
        .from('po_payments')
        .select('*')
        .eq('po_id', id)
        .order('payment_date', { ascending: false }),
    ]);

    if (!poRes.data) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });

    res.json({
      purchase_order: poRes.data,
      items:          itemsRes.data    || [],
      receipts:       receiptsRes.data || [],
      payments:       paymentsRes.data || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// TẠO / CẬP NHẬT ĐƠN NHẬP HÀNG
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/purchase-orders
const createPurchaseOrder = async (req, res) => {
  try {
    const {
      supplier_id, branch_id, order_date, expected_date,
      payment_terms, payment_method, notes, items = [],
    } = req.body;

    if (!items.length)
      return res.status(400).json({ error: 'Đơn hàng cần ít nhất 1 dòng xe' });

    // Tính ngày hạn thanh toán
    const oDate      = new Date(order_date || Date.now());
    const terms      = payment_terms ?? 30;
    const dueDate    = new Date(oDate);
    dueDate.setDate(dueDate.getDate() + terms);

    // Tạo đầu phiếu (po_number tự sinh qua trigger)
    const { data: po, error: poErr } = await supabaseAdmin
      .from('purchase_orders')
      .insert([{
        supplier_id,
        branch_id:        branch_id || null,
        order_date:       oDate.toISOString().slice(0, 10),
        expected_date:    expected_date || null,
        payment_terms:    terms,
        payment_method:   payment_method || null,
        payment_due_date: dueDate.toISOString().slice(0, 10),
        notes:            notes || null,
        status:           'draft',
        created_by:       req.user.sub,
      }])
      .select()
      .single();

    if (poErr) return res.status(400).json({ error: poErr.message });

    // Thêm dòng chi tiết
    const itemRows = items.map((it, idx) => ({
      po_id:            po.id,
      line_number:      idx + 1,
      vehicle_model_id: it.vehicle_model_id,
      color:            it.color     || null,
      year_manufacture: it.year_manufacture || null,
      qty_ordered:      it.qty_ordered,
      unit_cost:        it.unit_cost,
      vat_rate:         it.vat_rate ?? 10,
      notes:            it.notes    || null,
    }));

    const { error: itemErr } = await supabaseAdmin
      .from('purchase_order_items')
      .insert(itemRows);

    if (itemErr) {
      await supabaseAdmin.from('purchase_orders').delete().eq('id', po.id);
      return res.status(400).json({ error: itemErr.message });
    }

    // Lấy lại PO với tổng tiền đã được trigger cập nhật
    const { data: finalPO } = await supabaseAdmin
      .from('purchase_orders')
      .select('*')
      .eq('id', po.id)
      .single();

    res.status(201).json({ message: `Đã tạo đơn nhập hàng ${po.po_number}`, data: finalPO });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/purchase-orders/:id
const updatePurchaseOrder = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: current } = await supabaseAdmin
      .from('purchase_orders')
      .select('status, po_number')
      .eq('id', id)
      .single();

    if (!current) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });

    if (!['draft','submitted'].includes(current.status))
      return res.status(409).json({
        error: `Đơn ${current.po_number} đang ở trạng thái ${current.status}, chỉ được sửa khi còn draft hoặc submitted`,
      });

    const allowed = ['expected_date','payment_terms','payment_method',
                     'warehouse_note','notes','supplier_invoice_number',
                     'supplier_invoice_date','supplier_invoice_url'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: `Đã cập nhật đơn ${current.po_number}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// THAY ĐỔI TRẠNG THÁI ĐƠN
// ═══════════════════════════════════════════════════════════════════════════════

// PATCH /api/purchase-orders/:id/status
const updatePOStatus = async (req, res) => {
  try {
    const { id }        = req.params;
    const { status, cancel_reason } = req.body;

    const { data: current } = await supabaseAdmin
      .from('purchase_orders')
      .select('status, po_number')
      .eq('id', id)
      .single();

    if (!current) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });

    // Kiểm tra luồng trạng thái hợp lệ
    const allowedTransitions = {
      draft:             ['submitted','cancelled'],
      submitted:         ['approved','rejected','cancelled'],
      approved:          ['partial_received','cancelled'],
      partial_received:  ['fully_received'],
      fully_received:    ['invoiced'],
      invoiced:          ['paid'],
    };

    const allowed = allowedTransitions[current.status] || [];
    if (!allowed.includes(status))
      return res.status(409).json({
        error: `Không thể chuyển từ ${current.status} sang ${status}`,
      });

    const updates = { status };
    if (status === 'cancelled') updates.cancel_reason = cancel_reason || null;
    if (status === 'submitted') updates.submitted_by  = req.user.sub;
    if (status === 'approved')  updates.approved_by   = req.user.sub;

    const { data, error } = await supabaseAdmin
      .from('purchase_orders')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: `Đơn ${current.po_number} đã chuyển sang ${status}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// PHIẾU NHẬN HÀNG (Receipts)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/purchase-orders/:id/receipts — Tạo phiếu nhận hàng
const createReceipt = async (req, res) => {
  try {
    const { id: poId }    = req.params;
    const { receipt_date, notes } = req.body;

    // Kiểm tra PO đang ở trạng thái có thể nhận hàng
    const { data: po } = await supabaseAdmin
      .from('purchase_orders')
      .select('status, po_number')
      .eq('id', poId)
      .single();

    if (!po) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });
    if (!['approved','partial_received'].includes(po.status))
      return res.status(409).json({
        error: `Đơn ${po.po_number} chưa được duyệt hoặc không còn hàng chờ giao`,
      });

    // receipt_number tự sinh qua trigger
    const { data, error } = await supabaseAdmin
      .from('purchase_receipts')
      .insert([{
        po_id:        poId,
        receipt_date: receipt_date || new Date().toISOString().slice(0, 10),
        status:       'pending',
        received_by:  req.user.sub,
        notes:        notes || null,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: `Đã tạo phiếu nhận hàng ${data.receipt_number}`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/purchase-orders/receipts/:receiptId/items — Thêm xe vào phiếu
const addReceiptItems = async (req, res) => {
  try {
    const { receiptId } = req.params;
    const { items }     = req.body;

    if (!Array.isArray(items) || !items.length)
      return res.status(400).json({ error: 'Cần ít nhất 1 xe' });

    const { data: receipt } = await supabaseAdmin
      .from('purchase_receipts')
      .select('status, po_id')
      .eq('id', receiptId)
      .single();

    if (!receipt) return res.status(404).json({ error: 'Không tìm thấy phiếu nhận hàng' });
    if (receipt.status !== 'pending')
      return res.status(409).json({ error: 'Phiếu đã được xử lý, không thể thêm xe' });

    // Lấy số dòng hiện tại để tiếp tục đánh số
    const { count } = await supabaseAdmin
      .from('purchase_receipt_items')
      .select('*', { count: 'exact', head: true })
      .eq('receipt_id', receiptId);

    const rows = items.map((it, idx) => ({
      receipt_id:      receiptId,
      po_item_id:      it.po_item_id,
      line_number:     (count || 0) + idx + 1,
      vin:             it.vin             || null,
      engine_number:   it.engine_number   || null,
      battery_serial:  it.battery_serial  || null,
      color:           it.color           || null,
      year_manufacture: it.year_manufacture || null,
      condition:       it.condition       || 'ok',
      defect_notes:    it.defect_notes    || null,
      actual_unit_cost: it.actual_unit_cost || null,
    }));

    const { data, error } = await supabaseAdmin
      .from('purchase_receipt_items')
      .insert(rows)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: `Đã thêm ${data.length} xe vào phiếu nhận`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/purchase-orders/receipts/:receiptId/accept — Chấp nhận + nhập kho
const acceptReceipt = async (req, res) => {
  try {
    const { receiptId }    = req.params;
    const { inspection_notes, items } = req.body;

    const { data: receipt } = await supabaseAdmin
      .from('purchase_receipts')
      .select('status, receipt_number')
      .eq('id', receiptId)
      .single();

    if (!receipt) return res.status(404).json({ error: 'Không tìm thấy phiếu nhận hàng' });
    if (receipt.status === 'accepted')
      return res.status(409).json({ error: 'Phiếu đã được chấp nhận trước đó' });

    // Cập nhật từng dòng xe (condition, vin, notes...)
    if (items && items.length) {
      for (const it of items) {
        await supabaseAdmin
          .from('purchase_receipt_items')
          .update({
            condition:        it.condition,
            defect_notes:     it.defect_notes     || null,
            vin:              it.vin              || null,
            engine_number:    it.engine_number    || null,
            battery_serial:   it.battery_serial   || null,
            actual_unit_cost: it.actual_unit_cost || null,
          })
          .eq('id', it.id)
          .eq('receipt_id', receiptId);
      }
    }

    // Chuyển trạng thái → accepted: trigger tự tạo inventory_vehicles + cập nhật PO
    const { data, error } = await supabaseAdmin
      .from('purchase_receipts')
      .update({
        status:           'accepted',
        inspection_notes: inspection_notes || null,
        inspected_by:     req.user.sub,
      })
      .eq('id', receiptId)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Đếm xe đã vào kho từ phiếu này
    const { count: vehicleCount } = await supabaseAdmin
      .from('purchase_receipt_items')
      .select('*', { count: 'exact', head: true })
      .eq('receipt_id', receiptId)
      .in('condition', ['ok','defect']);

    res.json({
      message: `Phiếu ${receipt.receipt_number} đã chấp nhận — ${vehicleCount} xe nhập kho thành công`,
      data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/receipts/:receiptId — Chi tiết phiếu nhận
const getReceiptDetail = async (req, res) => {
  try {
    const { receiptId } = req.params;

    const [receiptRes, itemsRes] = await Promise.all([
      supabaseAdmin
        .from('purchase_receipts')
        .select(`
          *,
          purchase_orders ( po_number, supplier_id,
            acc_suppliers ( supplier_name ) )
        `)
        .eq('id', receiptId)
        .single(),

      supabaseAdmin
        .from('purchase_receipt_items')
        .select(`
          *,
          purchase_order_items (
            vehicle_model_id, unit_cost,
            vehicle_models ( brand, model_name, category )
          ),
          inventory_vehicles ( id, vin, status )
        `)
        .eq('receipt_id', receiptId)
        .order('line_number'),
    ]);

    if (!receiptRes.data) return res.status(404).json({ error: 'Không tìm thấy phiếu nhận hàng' });
    res.json({ receipt: receiptRes.data, items: itemsRes.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// THANH TOÁN NCC
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/purchase-orders/:id/payments
const createPayment = async (req, res) => {
  try {
    const { id: poId }  = req.params;
    const { amount, payment_method, payment_date, bank_reference, note } = req.body;

    const { data: po } = await supabaseAdmin
      .from('purchase_orders')
      .select('status, po_number, balance_due, total_amount')
      .eq('id', poId)
      .single();

    if (!po) return res.status(404).json({ error: 'Không tìm thấy đơn nhập hàng' });
    if (!['fully_received','invoiced','paid'].includes(po.status))
      return res.status(409).json({ error: 'Chỉ thanh toán sau khi đã nhận hàng và có hoá đơn' });
    if (amount > po.balance_due)
      return res.status(400).json({
        error: `Số tiền thanh toán (${amount.toLocaleString()}) vượt quá số còn nợ (${po.balance_due.toLocaleString()})`,
      });

    // payment_number tự sinh qua trigger
    const { data, error } = await supabaseAdmin
      .from('po_payments')
      .insert([{
        po_id: poId,
        amount,
        payment_method,
        payment_date:   payment_date   || new Date().toISOString().slice(0, 10),
        bank_reference: bank_reference || null,
        note:           note           || null,
        created_by:     req.user.sub,
      }])
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // Lấy lại balance_due sau khi trigger cập nhật
    const { data: updatedPO } = await supabaseAdmin
      .from('purchase_orders')
      .select('status, paid_amount, balance_due')
      .eq('id', poId)
      .single();

    res.status(201).json({
      message: `Đã ghi nhận thanh toán ${data.payment_number} cho đơn ${po.po_number}`,
      payment: data,
      po_summary: {
        status:       updatedPO.status,
        paid_amount:  updatedPO.paid_amount,
        balance_due:  updatedPO.balance_due,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/purchase-orders/monthly-summary — Báo cáo nhập hàng theo tháng
const getMonthlySummary = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_po_monthly_summary')
      .select('*')
      .limit(24);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getPurchaseOrders,
  getActionRequired,
  getPurchaseOrderDetail,
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePOStatus,
  createReceipt,
  addReceiptItems,
  acceptReceipt,
  getReceiptDetail,
  createPayment,
  getMonthlySummary,
};
