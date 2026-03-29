const { supabaseAdmin } = require('../config/supabase');

// Lấy danh sách kho xe
const getInventory = async (req, res) => {
  try {
    const { status, model_id, color, page = 1, limit = 20 } = req.query;
    let query = supabaseAdmin
      .from('inventory_vehicles')
      .select(`
        *,
        vehicle_models (brand, model_name, category, price_sell, image_url)
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (status) query = query.eq('status', status);
    if (model_id) query = query.eq('vehicle_model_id', model_id);
    if (color) query = query.ilike('color', `%${color}%`);

    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Thêm xe vào kho
const addVehicle = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('inventory_vehicles')
      .insert([req.body])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật trạng thái xe
const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('inventory_vehicles')
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

// Tóm tắt tồn kho
const getStockSummary = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_vehicle_stock_summary')
      .select('*');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Phụ tùng
const getSpareParts = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('spare_parts')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cảnh báo tồn kho thấp
const getLowStockAlert = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('spare_parts')
      .select('*')
      .filter('qty_in_stock', 'lte', 'qty_minimum');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Xóa xe khỏi kho (chỉ được xóa khi status = in_stock hoặc demo)
const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra trạng thái trước khi xóa
    const { data: xe, error: fetchErr } = await supabaseAdmin
      .from('inventory_vehicles')
      .select('status, vin')
      .eq('id', id)
      .single();

    if (fetchErr || !xe) return res.status(404).json({ error: 'Không tìm thấy xe' });
    if (['sold', 'warranty_repair'].includes(xe.status)) {
      return res.status(400).json({ error: `Không thể xóa xe ${xe.vin} đang có trạng thái "${xe.status}"` });
    }

    const { error } = await supabaseAdmin.from('inventory_vehicles').delete().eq('id', id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: `Đã xóa xe ${xe.vin} khỏi kho` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getInventory, addVehicle, updateVehicle, deleteVehicle, getStockSummary, getSpareParts, getLowStockAlert };
