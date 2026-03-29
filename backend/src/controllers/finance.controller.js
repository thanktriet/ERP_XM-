const { supabaseAdmin } = require('../config/supabase');

// Danh sách giao dịch
const getTransactions = async (req, res) => {
  try {
    const { type, category, from_date, to_date, page = 1, limit = 20 } = req.query;
    let query = supabaseAdmin
      .from('finance_transactions')
      .select('*, users!created_by(full_name)', { count: 'exact' })
      .order('transaction_date', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (type) query = query.eq('type', type);
    if (category) query = query.eq('category', category);
    if (from_date) query = query.gte('transaction_date', from_date);
    if (to_date) query = query.lte('transaction_date', to_date);
    const { data, error, count } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json({ data, total: count, page: +page, limit: +limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tạo giao dịch thủ công
const createTransaction = async (req, res) => {
  try {
    const { count } = await supabaseAdmin.from('finance_transactions').select('*', { count: 'exact', head: true });
    const transaction_number = `${req.body.type === 'income' ? 'THU' : 'CHI'}-${String(count + 1).padStart(6, '0')}`;
    const { data, error } = await supabaseAdmin
      .from('finance_transactions')
      .insert([{ ...req.body, transaction_number, created_by: req.user?.sub }])
      .select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Báo cáo doanh thu theo tháng
const getMonthlyRevenue = async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('v_monthly_revenue').select('*').limit(12);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Tổng quan tài chính (dashboard)
const getFinanceSummary = async (req, res) => {
  try {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    const { data } = await supabaseAdmin
      .from('finance_transactions')
      .select('type, amount')
      .gte('transaction_date', firstDay)
      .lte('transaction_date', lastDay);

    const summary = (data || []).reduce((acc, t) => {
      if (t.type === 'income') acc.income += Number(t.amount);
      else acc.expense += Number(t.amount);
      return acc;
    }, { income: 0, expense: 0 });

    summary.profit = summary.income - summary.expense;
    res.json({ month: `${today.getMonth() + 1}/${today.getFullYear()}`, ...summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getTransactions, createTransaction, getMonthlyRevenue, getFinanceSummary };
