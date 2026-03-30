const { supabaseAdmin } = require('../config/supabase');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const userId = (req) => req.user?.sub || req.user?.id || null;

const pickAccessoryFields = (body, isCreate = false) => {
  const allowed = ['name', 'brand', 'category', 'unit', 'qty_minimum',
                   'price_cost', 'price_sell', 'supplier', 'compatible_models',
                   'image_url', 'note', 'is_active'];
  const obj = {};
  allowed.forEach(f => { if (body[f] !== undefined) obj[f] = body[f]; });
  if (isCreate) {
    obj.unit         = obj.unit         ?? 'cái';
    obj.qty_minimum  = obj.qty_minimum  ?? 3;
    obj.price_cost   = obj.price_cost   ?? 0;
    obj.price_sell   = obj.price_sell   ?? 0;
    obj.qty_in_stock = 0;
    obj.is_active    = true;
    // code tự sinh bởi trigger generate_accessory_code — không cần truyền vào
  }
  return obj;
};

// ─── Danh sách phụ kiện ───────────────────────────────────────────────────────
const getAccessories = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const { search, category, is_active, model_id } = req.query;

    let q = supabaseAdmin
      .from('accessories')
      .select('*', { count: 'exact' })
      .order('name');

    if (is_active === 'all') { /* không lọc */ }
    else if (is_active === 'false') q = q.eq('is_active', false);
    else q = q.eq('is_active', true);

    if (category) q = q.eq('category', category);
    if (search)   q = q.or(`name.ilike.%${search}%,code.ilike.%${search}%,brand.ilike.%${search}%`);

    // Lọc theo dòng xe: lấy phụ kiện của model_id đó HOẶC dùng cho tất cả xe (compatible_models = null/rỗng)
    if (model_id) {
      q = q.or(`compatible_models.is.null,compatible_models.eq.{},compatible_models.cs.{${model_id}}`);
    }

    q = q.range((page - 1) * limit, page * limit - 1);
    const { data, count, error } = await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Chi tiết một phụ kiện ────────────────────────────────────────────────────
const getAccessoryById = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('accessories').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy phụ kiện' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Tạo phụ kiện mới ─────────────────────────────────────────────────────────
const createAccessory = async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ error: 'Thiếu tên phụ kiện' });
    const { data, error } = await supabaseAdmin
      .from('accessories')
      .insert([pickAccessoryFields(req.body, true)])
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ message: `Đã thêm phụ kiện "${data.name}"`, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Cập nhật phụ kiện ────────────────────────────────────────────────────────
const updateAccessory = async (req, res) => {
  try {
    const fields = pickAccessoryFields(req.body, false);
    if (!Object.keys(fields).length)
      return res.status(400).json({ error: 'Không có trường nào để cập nhật' });
    const { data, error } = await supabaseAdmin
      .from('accessories').update(fields).eq('id', req.params.id).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ message: 'Đã cập nhật phụ kiện', data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Nhập kho phụ kiện ────────────────────────────────────────────────────────
const accessoryStockIn = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, unit_cost, note, reference_code, supplier } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: 'Số lượng nhập phải > 0' });

    const { data: item, error: fetchErr } = await supabaseAdmin
      .from('accessories').select('name, qty_in_stock, unit').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy phụ kiện' });

    // Tạo item_movement dương → trigger tự cộng qty_in_stock
    const { error: mvErr } = await supabaseAdmin
      .from('item_movements')
      .insert([{
        item_type: 'accessory', item_id: id,
        movement_type: 'import',
        quantity:      +quantity,
        unit_cost:     unit_cost       || 0,
        reference_code: reference_code || null,
        supplier:      supplier        || null,
        note:          note            || null,
        created_by:    userId(req),
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });
    res.json({ message: `Đã nhập ${quantity} ${item.unit} "${item.name}" (tồn mới: ${item.qty_in_stock + (+quantity)})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Xuất kho phụ kiện ────────────────────────────────────────────────────────
const accessoryStockOut = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, movement_type = 'export_sale', note, order_id } = req.body;
    if (!quantity || quantity <= 0)
      return res.status(400).json({ error: 'Số lượng xuất phải > 0' });

    const validTypes = ['export_sale', 'export_gift', 'export_warranty', 'adjust_minus', 'return'];
    const mvType = validTypes.includes(movement_type) ? movement_type : 'export_sale';

    const { data: item, error: fetchErr } = await supabaseAdmin
      .from('accessories').select('name, qty_in_stock, unit').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy phụ kiện' });
    if (item.qty_in_stock < quantity)
      return res.status(409).json({ error: `Tồn kho không đủ (hiện có: ${item.qty_in_stock} ${item.unit})` });

    // Tạo item_movement âm → trigger tự trừ qty_in_stock
    const { error: mvErr } = await supabaseAdmin
      .from('item_movements')
      .insert([{
        item_type: 'accessory', item_id: id,
        movement_type: mvType,
        quantity:  -(+quantity),
        order_id:  order_id || null,
        note:      note     || null,
        created_by: userId(req),
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });
    res.json({ message: `Đã xuất ${quantity} ${item.unit} "${item.name}" (tồn mới: ${item.qty_in_stock - (+quantity)})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Điều chỉnh kho (kiểm kê) ────────────────────────────────────────────────
const accessoryAdjust = async (req, res) => {
  try {
    const { id } = req.params;
    const { qty_actual, note } = req.body;
    if (qty_actual === undefined || qty_actual < 0)
      return res.status(400).json({ error: 'Số lượng thực tế phải >= 0' });

    const { data: item, error: fetchErr } = await supabaseAdmin
      .from('accessories').select('name, qty_in_stock, unit').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy phụ kiện' });

    const diff = (+qty_actual) - item.qty_in_stock;
    if (diff === 0) return res.json({ message: 'Tồn kho không thay đổi', delta: 0 });

    const { error: mvErr } = await supabaseAdmin
      .from('item_movements')
      .insert([{
        item_type: 'accessory', item_id: id,
        movement_type: diff > 0 ? 'adjust_plus' : 'adjust_minus',
        quantity:  diff,    // trigger cộng trực tiếp (âm → trừ, dương → cộng)
        note:      note || `Kiểm kê: ${item.qty_in_stock} → ${qty_actual}`,
        created_by: userId(req),
      }]);

    if (mvErr) return res.status(400).json({ error: mvErr.message });
    res.json({ message: `Đã điều chỉnh "${item.name}": ${item.qty_in_stock} → ${qty_actual}`, delta: diff });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Lịch sử nhập/xuất ────────────────────────────────────────────────────────
const getAccessoryMovements = async (req, res) => {
  try {
    const { id } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const { data, count, error } = await supabaseAdmin
      .from('item_movements')
      .select('*, users(full_name)', { count: 'exact' })
      .eq('item_type', 'accessory').eq('item_id', id)
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── Cảnh báo tồn thấp ────────────────────────────────────────────────────────
const getAccessoryLowStock = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('v_accessory_stock_alert').select('*').order('surplus');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: data?.length || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getAccessories, getAccessoryById, createAccessory, updateAccessory,
  accessoryStockIn, accessoryStockOut, accessoryAdjust,
  getAccessoryMovements, getAccessoryLowStock,
};
