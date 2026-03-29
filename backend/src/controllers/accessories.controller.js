const { supabaseAdmin } = require('../config/supabase');

// Lấy danh sách phụ kiện
// Query params: category, search, model_id, is_active (mặc định 'true')
const getAccessories = async (req, res) => {
  try {
    const { category, search, model_id, is_active = 'true' } = req.query;

    let query = supabaseAdmin
      .from('accessories')
      .select('*')
      .order('category')
      .order('name');

    // Lọc theo trạng thái hoạt động (mặc định chỉ lấy active)
    if (is_active !== 'all') {
      query = query.eq('is_active', is_active === 'true');
    }

    if (category) query = query.eq('category', category);

    if (search) {
      query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });

    // Lọc theo model tương thích ở tầng ứng dụng
    // compatible_models = null hoặc mảng rỗng → tương thích tất cả xe
    const filtered = model_id
      ? data.filter(a =>
          !a.compatible_models ||
          a.compatible_models.length === 0 ||
          a.compatible_models.includes(model_id)
        )
      : data;

    res.json({ data: filtered, total: filtered.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Chi tiết một phụ kiện
const getAccessoryById = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('accessories')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) return res.status(404).json({ error: 'Không tìm thấy phụ kiện' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo phụ kiện mới
const createAccessory = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('accessories')
      .insert([req.body])
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cập nhật phụ kiện
const updateAccessory = async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('accessories')
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

// Bật/tắt trạng thái hoạt động
const toggleAccessory = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: cur, error: fetchErr } = await supabaseAdmin
      .from('accessories').select('is_active').eq('id', id).single();
    if (fetchErr) return res.status(404).json({ error: 'Không tìm thấy phụ kiện' });

    const { data, error } = await supabaseAdmin
      .from('accessories')
      .update({ is_active: !cur.is_active })
      .eq('id', id)
      .select()
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getAccessories, getAccessoryById, createAccessory, updateAccessory, toggleAccessory };
