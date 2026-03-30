const { supabaseAdmin } = require('../config/supabase');

// ══════════════════════════════════════════════════════════════════
//  FEE SETTINGS — Phí cố định
// ══════════════════════════════════════════════════════════════════

// GET /api/settings/fees
const getFees = async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let q = supabaseAdmin.from('fee_settings').select('*').order('sort_order');
    if (!showAll) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/settings/fees/:id
const updateFee = async (req, res) => {
  try {
    const { label, amount, is_active, note, sort_order } = req.body;
    const update = {};
    if (label      !== undefined) update.label      = label;
    if (amount     !== undefined) update.amount      = Number(amount);
    if (is_active  !== undefined) update.is_active   = is_active;
    if (note       !== undefined) update.note        = note;
    if (sort_order !== undefined) update.sort_order  = Number(sort_order);

    const { data, error } = await supabaseAdmin
      .from('fee_settings')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/settings/fees
const createFee = async (req, res) => {
  try {
    const { key, label, amount, note, sort_order } = req.body;
    if (!key || !label) return res.status(400).json({ error: 'key và label là bắt buộc' });
    const { data, error } = await supabaseAdmin
      .from('fee_settings')
      .insert({ key, label, amount: Number(amount) || 0, note, sort_order: Number(sort_order) || 99 })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/settings/fees/:id
const deleteFee = async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('fee_settings')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════
//  REGISTRATION SERVICES — Dịch vụ đăng ký
// ══════════════════════════════════════════════════════════════════

// GET /api/settings/services
const getServices = async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    let q = supabaseAdmin.from('registration_services').select('*').order('sort_order');
    if (!showAll) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/settings/services/:id
const updateService = async (req, res) => {
  try {
    const { name, description, price, is_active, sort_order } = req.body;
    const update = {};
    if (name        !== undefined) update.name        = name;
    if (description !== undefined) update.description = description;
    if (price       !== undefined) update.price       = Number(price);
    if (is_active   !== undefined) update.is_active   = is_active;
    if (sort_order  !== undefined) update.sort_order  = Number(sort_order);

    const { data, error } = await supabaseAdmin
      .from('registration_services')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/settings/services
const createService = async (req, res) => {
  try {
    const { name, description, price, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: 'name là bắt buộc' });
    const { data, error } = await supabaseAdmin
      .from('registration_services')
      .insert({ name, description, price: Number(price) || 0, sort_order: Number(sort_order) || 99 })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/settings/services/:id
const deleteService = async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('registration_services')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getFees, updateFee, createFee, deleteFee, getServices, updateService, createService, deleteService };
