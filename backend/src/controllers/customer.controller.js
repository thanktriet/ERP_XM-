const { supabaseAdmin } = require('../config/supabase');

// Danh sách khách hàng
const getCustomers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    let query = supabaseAdmin
      .from('customers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,customer_code.ilike.%${search}%,email.ilike.%${search}%`);
    }
    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Thêm khách hàng
const createCustomer = async (req, res) => {
  try {
    // Lấy mã KH lớn nhất hiện có để tránh trùng khi xóa/thêm đồng thời
    const { data: lastRow } = await supabaseAdmin
      .from('customers')
      .select('customer_code')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextNum = 1;
    if (lastRow?.customer_code) {
      // customer_code dạng "KH000001" → lấy phần số
      const num = parseInt(lastRow.customer_code.replace(/^KH/, ''), 10);
      if (!isNaN(num)) nextNum = num + 1;
    }
    const customer_code = `KH${String(nextNum).padStart(6, '0')}`;

    const { data, error } = await supabaseAdmin
      .from('customers')
      .insert([{ ...req.body, customer_code }])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết khách hàng kèm lịch sử mua xe
const getCustomerDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const [customerRes, ordersRes, warrantyRes] = await Promise.all([
      supabaseAdmin.from('customers').select('*').eq('id', id).single(),
      supabaseAdmin.from('sales_orders').select(`
        *, sales_order_items(*, vehicle_models(brand, model_name))
      `).eq('customer_id', id).order('order_date', { ascending: false }),
      supabaseAdmin.from('warranty_records').select(`
        *, inventory_vehicles(vin, vehicle_models(brand, model_name))
      `).eq('customer_id', id)
    ]);
    if (customerRes.error) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });
    res.json({
      customer: customerRes.data,
      orders: ordersRes.data,
      warranties: warrantyRes.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật khách hàng
const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('customers')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getCustomers, createCustomer, getCustomerDetail, updateCustomer };
