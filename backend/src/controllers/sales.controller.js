const { supabaseAdmin } = require('../config/supabase');

// ══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE — luồng chuyển trạng thái hợp lệ
// ══════════════════════════════════════════════════════════════════════════════

const VALID_TRANSITIONS = {
  draft:              ['confirmed', 'cancelled'],
  confirmed:          ['deposit_paid', 'full_paid', 'cancelled'],
  deposit_paid:       ['full_paid', 'cancelled'],
  full_paid:          ['invoice_requested', 'cancelled'],
  invoice_requested:  ['invoice_approved', 'cancelled'],
  invoice_approved:   ['pdi_pending'],          // fix: tự động nhưng phải khai báo hợp lệ
  pdi_pending:        ['pdi_done', 'cancelled'],
  pdi_done:           ['delivered', 'cancelled'],
  delivered:          [],
  cancelled:          [],
};

// Quyền theo khoá "fromStatus→toStatus"
const TRANSITION_ROLES = {
  'draft→confirmed':                    ['sales', 'manager', 'admin'],
  'confirmed→deposit_paid':             ['sales', 'accountant', 'manager', 'admin'],
  'deposit_paid→deposit_paid':          ['sales', 'accountant', 'manager', 'admin'],
  'confirmed→full_paid':                ['accountant', 'manager', 'admin'],
  'deposit_paid→full_paid':             ['accountant', 'manager', 'admin'],
  'full_paid→invoice_requested':        ['sales', 'manager', 'admin'],
  'invoice_requested→invoice_approved': ['manager', 'admin'],
  'invoice_approved→pdi_pending':       ['manager', 'admin'],  // fix: tự động nhưng cần khai báo
  'pdi_pending→pdi_done':               ['technician', 'manager', 'admin'],
  'pdi_done→delivered':                 ['sales', 'manager', 'admin'],
};
// cancelled: mọi trạng thái (trừ delivered) → admin + manager
// đặc biệt: draft → cancelled thêm sales

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function canTransition(fromStatus, toStatus, userRole) {
  // Terminal states
  if (!VALID_TRANSITIONS[fromStatus]) return false;
  if (!VALID_TRANSITIONS[fromStatus].includes(toStatus)) return false;

  // Chuyển sang cancelled
  if (toStatus === 'cancelled') {
    if (['admin', 'manager'].includes(userRole)) return true;
    if (fromStatus === 'draft' && userRole === 'sales') return true;
    return false;
  }

  const key = `${fromStatus}→${toStatus}`;
  const allowed = TRANSITION_ROLES[key];
  if (!allowed) return false;
  return allowed.includes(userRole);
}

// ══════════════════════════════════════════════════════════════════════════════
// TRANSITION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

async function handleConfirm(orderId) {
  const { data, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'confirmed' })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleDepositPaid(orderId, deposit_amount, currentDeposit) {
  const totalDeposit = (currentDeposit || 0) + parseFloat(deposit_amount);
  const { data, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'deposit_paid', deposit_amount: totalDeposit })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleFullPaid(orderId, { receipt_number, receipt_date, payment_note }, orderData) {
  // Kiểm tra số phiếu thu không trùng
  const { data: existing } = await supabaseAdmin
    .from('sales_orders')
    .select('id')
    .eq('receipt_number', receipt_number)
    .neq('id', orderId)
    .maybeSingle();
  if (existing) throw { status: 422, message: `Số phiếu thu "${receipt_number}" đã tồn tại` };

  const { data: order, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'full_paid', receipt_number, receipt_date, payment_note })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Sinh giao dịch tài chính — thu đủ tiền
  const { data: lastFT } = await supabaseAdmin
    .from('finance_transactions')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const ftNum = `THU-${orderData.order_number}-${receipt_number}`;

  await supabaseAdmin.from('finance_transactions').insert([{
    transaction_number:  ftNum,
    type:                'income',
    category:            'ban_hang',
    amount:              orderData.total_amount,
    payment_method:      orderData.payment_method,
    reference_id:        orderId,
    reference_type:      'sales_order',
    description:         `Thu đủ tiền đơn hàng ${orderData.order_number} — phiếu ${receipt_number}`,
    transaction_date:    receipt_date,
    notes:               payment_note || null,
  }]);

  return order;
}

async function handleInvoiceRequested(orderId) {
  const { data, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'invoice_requested' })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleInvoiceApproved(orderId, approverId) {
  // Hai bước trong một: invoice_approved → pdi_pending (tự động)
  // Lưu approved_by, rồi ngay lập tức chuyển sang pdi_pending
  const { error: e1 } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'invoice_approved', approved_by: approverId })
    .eq('id', orderId);
  if (e1) throw new Error(e1.message);

  const { data, error: e2 } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'pdi_pending' })
    .eq('id', orderId)
    .select()
    .single();
  if (e2) throw new Error(e2.message);
  return data; // trả về pdi_pending
}

async function handlePdiDone(orderId, pdi_notes, technicianId) {
  const { data, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'pdi_done', pdi_notes, technician_id: technicianId })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function handleDeliver(orderId, existingDeliveryDate) {
  const deliveryDate = existingDeliveryDate || new Date().toISOString().split('T')[0];
  const { data: order, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'delivered', delivery_date: deliveryDate })
    .eq('id', orderId)
    .select('*, sales_order_items(inventory_vehicle_id, vehicle_models(warranty_months))')
    .single();
  if (error) throw new Error(error.message);

  // Tạo hồ sơ bảo hành cho từng xe
  for (const item of order.sales_order_items || []) {
    if (!item.inventory_vehicle_id) continue;
    const months = item.vehicle_models?.warranty_months || 24;
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + months);

    const { count } = await supabaseAdmin
      .from('warranty_records')
      .select('*', { count: 'exact', head: true });
    await supabaseAdmin.from('warranty_records').insert([{
      warranty_number:      `BH${String((count || 0) + 1).padStart(6, '0')}`,
      customer_id:          order.customer_id,
      inventory_vehicle_id: item.inventory_vehicle_id,
      sales_order_id:       orderId,
      start_date:           startDate.toISOString().split('T')[0],
      end_date:             endDate.toISOString().split('T')[0],
      status:               'active',
    }]);
  }
  return order;
}

async function handleCancel(orderId, cancel_reason, order) {
  const currentStatus = order.status;

  const { data, error } = await supabaseAdmin
    .from('sales_orders')
    .update({ status: 'cancelled', cancel_reason })
    .eq('id', orderId)
    .select()
    .single();
  if (error) throw new Error(error.message);

  // Tạo giao dịch hoàn tiền nếu đơn đã thu tiền
  const paidStatuses = ['full_paid', 'invoice_requested', 'invoice_approved', 'pdi_pending', 'pdi_done'];
  if (paidStatuses.includes(currentStatus) && (order.total_amount ?? 0) > 0) {
    const refundNum = `HOAN-${order.order_number}`;
    await supabaseAdmin.from('finance_transactions').insert([{
      transaction_number: refundNum,
      type:               'expense',
      category:           'hoan_tien',
      amount:             order.total_amount,
      payment_method:     order.payment_method || 'cash',
      reference_id:       orderId,
      reference_type:     'sales_order',
      description:        `Hoàn tiền huỷ đơn ${order.order_number} — lý do: ${cancel_reason}`,
      transaction_date:   new Date().toISOString().split('T')[0],
    }]);
  }

  // Hoàn tiền cọc (nếu đơn chỉ ở deposit_paid)
  if (currentStatus === 'deposit_paid' && (order.deposit_amount ?? 0) > 0) {
    const refundNum = `HOAN-COC-${order.order_number}`;
    await supabaseAdmin.from('finance_transactions').insert([{
      transaction_number: refundNum,
      type:               'expense',
      category:           'hoan_tien',
      amount:             order.deposit_amount,
      payment_method:     order.payment_method || 'cash',
      reference_id:       orderId,
      reference_type:     'sales_order',
      description:        `Hoàn tiền cọc huỷ đơn ${order.order_number} — lý do: ${cancel_reason}`,
      transaction_date:   new Date().toISOString().split('T')[0],
    }]);
  }

  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTROLLERS
// ══════════════════════════════════════════════════════════════════════════════

// Tạo đơn hàng mới (status = draft)
const createOrder = async (req, res) => {
  try {
    const {
      customer_id, salesperson_id, items, accessories = [],
      discount_amount = 0, payment_method, deposit_amount = 0,
      delivery_date, delivery_address, notes,
      promotions = [],   // [{ promotion_id, promo_name, promo_type, discount_amount, gift_item_id, gift_item_name, gift_quantity }]
      fees = [],         // [{ fee_key, fee_label, amount }]
      services = [],     // [{ service_id, service_name, price }]
    } = req.body;

    // Tính tổng tiền xe
    let subtotal = 0;
    for (const item of items) {
      const { data: vehicle } = await supabaseAdmin
        .from('vehicle_models').select('price_sell').eq('id', item.vehicle_model_id).single();
      item.unit_price = item.unit_price || vehicle?.price_sell || 0;
      item.line_total = item.unit_price * item.quantity * (1 - (item.discount_percent || 0) / 100);
      subtotal += item.line_total;
    }

    // Cộng phụ kiện
    const accessoriesSubtotal = accessories.reduce(
      (sum, a) => sum + (a.unit_price * (a.quantity || 1)), 0
    );
    subtotal += accessoriesSubtotal;

    // Cộng phí & dịch vụ
    const feesTotal    = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const servicesTotal = services.reduce((s, sv) => s + (Number(sv.price) || 0), 0);

    const total_amount = subtotal - discount_amount + feesTotal + servicesTotal;

    // Sinh mã đơn hàng dựa trên bản ghi mới nhất
    const { data: lastOrder } = await supabaseAdmin
      .from('sales_orders')
      .select('order_number')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextNum = 1;
    if (lastOrder?.order_number) {
      const year = new Date().getFullYear();
      const prefix = `DH${year}`;
      if (lastOrder.order_number.startsWith(prefix)) {
        const num = parseInt(lastOrder.order_number.replace(prefix, ''), 10);
        if (!isNaN(num)) nextNum = num + 1;
      }
    }
    const order_number = `DH${new Date().getFullYear()}${String(nextNum).padStart(5, '0')}`;

    // Tạo đơn — status mặc định là 'draft' để sales xem lại trước khi xác nhận
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('sales_orders')
      .insert([{
        order_number, customer_id,
        salesperson_id: salesperson_id || req.user?.sub,
        subtotal, discount_amount, total_amount, payment_method,
        deposit_amount, delivery_date, delivery_address, notes,
        status: 'draft',
      }])
      .select()
      .single();
    if (orderErr) return res.status(400).json({ error: orderErr.message });

    // Chi tiết đơn hàng (xe)
    const orderItems = items.map(item => ({ ...item, order_id: order.id }));
    const { error: itemsErr } = await supabaseAdmin.from('sales_order_items').insert(orderItems);
    if (itemsErr) return res.status(400).json({ error: itemsErr.message });

    // Phụ kiện đi kèm
    if (accessories.length > 0) {
      const accessoryRows = accessories.map(a => ({
        order_id:     order.id,
        accessory_id: a.accessory_id,
        quantity:     a.quantity || 1,
        unit_price:   a.unit_price,
        line_total:   a.unit_price * (a.quantity || 1),
      }));
      const { error: accErr } = await supabaseAdmin
        .from('sales_order_accessories')
        .insert(accessoryRows);
      if (accErr) console.error('⚠️ Lưu phụ kiện thất bại:', accErr.message);
    }

    // Khuyến mãi áp dụng
    if (promotions.length > 0) {
      const promoRows = promotions.map(p => ({ ...p, order_id: order.id }));
      const { error: promoErr } = await supabaseAdmin
        .from('sales_order_promotions').insert(promoRows);
      if (promoErr) console.error('⚠️ Lưu khuyến mãi thất bại:', promoErr.message);
    }

    // Phí cố định
    if (fees.length > 0) {
      const feeRows = fees.map(f => ({ ...f, order_id: order.id }));
      const { error: feeErr } = await supabaseAdmin
        .from('sales_order_fees').insert(feeRows);
      if (feeErr) console.error('⚠️ Lưu phí thất bại:', feeErr.message);
    }

    // Dịch vụ đăng ký
    if (services.length > 0) {
      const svcRows = services.map(s => ({ ...s, order_id: order.id }));
      const { error: svcErr } = await supabaseAdmin
        .from('sales_order_services').insert(svcRows);
      if (svcErr) console.error('⚠️ Lưu dịch vụ thất bại:', svcErr.message);
    }

    // Đặt trước xe (reserved) — chưa bán hẳn, chờ confirmed
    for (const item of items) {
      if (item.inventory_vehicle_id) {
        await supabaseAdmin
          .from('inventory_vehicles')
          .update({ status: 'reserved' })
          .eq('id', item.inventory_vehicle_id);
      }
    }

    res.status(201).json({ message: 'Tạo đơn hàng thành công', order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Danh sách đơn hàng
const getOrders = async (req, res) => {
  try {
    const { status, from_date, to_date, page = 1, limit = 20 } = req.query;
    let query = supabaseAdmin
      .from('sales_orders')
      .select(`*, customers(full_name, phone), users!salesperson_id(full_name)`, { count: 'exact' })
      .order('order_date', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) query = query.eq('status', status);
    if (from_date) query = query.gte('order_date', from_date);
    if (to_date) query = query.lte('order_date', to_date);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết đơn hàng
const getOrderDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('sales_orders')
      .select(`
        *,
        customers(id, customer_code, full_name, phone, email, address),
        users!salesperson_id(full_name, phone),
        approved_by_user:users!approved_by(full_name),
        technician:users!technician_id(full_name),
        sales_order_items(
          *,
          inventory_vehicles(vin, color),
          vehicle_models(brand, model_name, image_url, warranty_months)
        ),
        sales_order_accessories(*, accessories(id, code, name, category, image_url, unit, price_sell)),
        sales_order_promotions(*),
        sales_order_fees(*),
        sales_order_services(*)
      `)
      .eq('id', id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật trạng thái đơn hàng — state machine có phân quyền
const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status: toStatus, ...extraFields } = req.body;
    const userRole = req.user?.role;

    // Lấy đơn hiện tại
    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('sales_orders')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchErr || !order) return res.status(404).json({ error: 'Không tìm thấy đơn hàng' });

    const fromStatus = order.status;

    // Kiểm tra transition hợp lệ
    if (!canTransition(fromStatus, toStatus, userRole)) {
      if (!VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
        return res.status(409).json({
          error: `Không thể chuyển từ trạng thái "${fromStatus}" sang "${toStatus}"`,
        });
      }
      return res.status(403).json({
        error: `Vai trò "${userRole}" không có quyền thực hiện thao tác này`,
      });
    }

    // Gọi handler tương ứng
    let result;
    switch (toStatus) {
      case 'confirmed':
        result = await handleConfirm(id);
        // Cập nhật xe từ reserved → reserved (giữ nguyên, confirmed mới chắc chắn)
        break;

      case 'deposit_paid':
        if (!extraFields.deposit_amount) {
          return res.status(400).json({ error: 'Thiếu số tiền cọc' });
        }
        if (extraFields.deposit_amount > order.total_amount) {
          return res.status(400).json({ error: 'Số tiền cọc không được vượt quá tổng đơn hàng' });
        }
        result = await handleDepositPaid(id, extraFields.deposit_amount, order.deposit_amount);
        break;

      case 'full_paid':
        result = await handleFullPaid(id, {
          receipt_number: extraFields.receipt_number,
          receipt_date:   extraFields.receipt_date,
          payment_note:   extraFields.payment_note,
        }, order);
        // Cập nhật xe từ reserved → sold
        {
          const { data: items } = await supabaseAdmin
            .from('sales_order_items')
            .select('inventory_vehicle_id')
            .eq('order_id', id);
          for (const item of items || []) {
            if (item.inventory_vehicle_id) {
              await supabaseAdmin
                .from('inventory_vehicles')
                .update({ status: 'sold' })
                .eq('id', item.inventory_vehicle_id);
            }
          }
        }
        break;

      case 'invoice_requested':
        result = await handleInvoiceRequested(id);
        break;

      case 'invoice_approved':
        // Tự động chuyển thẳng sang pdi_pending
        result = await handleInvoiceApproved(id, req.user?.sub);
        break;

      case 'pdi_done':
        if (!extraFields.pdi_notes?.trim() || extraFields.pdi_notes.trim().length < 5) {
          return res.status(400).json({ error: 'Ghi chú PDI tối thiểu 5 ký tự' });
        }
        result = await handlePdiDone(id, extraFields.pdi_notes.trim(), req.user?.sub);
        break;

      case 'delivered':
        result = await handleDeliver(id, order.delivery_date);
        break;

      case 'cancelled':
        if (!extraFields.cancel_reason?.trim()) {
          return res.status(400).json({ error: 'Thiếu lý do huỷ đơn' });
        }
        result = await handleCancel(id, extraFields.cancel_reason.trim(), order);
        // Trả xe về kho nếu chưa giao
        {
          const { data: items } = await supabaseAdmin
            .from('sales_order_items')
            .select('inventory_vehicle_id')
            .eq('order_id', id);
          for (const item of items || []) {
            if (item.inventory_vehicle_id) {
              await supabaseAdmin
                .from('inventory_vehicles')
                .update({ status: 'in_stock' })
                .eq('id', item.inventory_vehicle_id);
            }
          }
        }
        break;

      default:
        return res.status(400).json({ error: 'Trạng thái không xác định' });
    }

    res.json({ message: 'Cập nhật trạng thái thành công', order: result });
  } catch (err) {
    const httpStatus = err.status || 500;
    res.status(httpStatus).json({ error: err.message });
  }
};

module.exports = { createOrder, getOrders, getOrderDetail, updateOrderStatus };
