const { supabaseAdmin } = require('../config/supabase');

// Dashboard tổng quan
const getDashboard = async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const firstOfMonth = today.substring(0, 7) + '-01';

    const [vehicleStock, ordersMonth, servicesOpen, lowStock, revenueMonth] = await Promise.all([
      supabaseAdmin.from('inventory_vehicles').select('status').eq('status', 'in_stock'),
      supabaseAdmin.from('sales_orders').select('total_amount').gte('order_date', firstOfMonth).neq('status', 'cancelled'),
      supabaseAdmin.from('service_requests').select('id').not('status', 'in', '(done,delivered,cancelled)'),
      supabaseAdmin.from('spare_parts').select('id, name, qty_in_stock, qty_minimum').filter('qty_in_stock', 'lte', 5),
      supabaseAdmin.from('finance_transactions').select('type, amount').eq('type', 'income').gte('transaction_date', firstOfMonth),
    ]);

    const totalRevenue = (revenueMonth.data || []).reduce((sum, t) => sum + Number(t.amount), 0);
    const totalOrders = (ordersMonth.data || []).length;

    res.json({
      vehicles_in_stock: vehicleStock.data?.length || 0,
      orders_this_month: totalOrders,
      open_service_tickets: servicesOpen.data?.length || 0,
      low_stock_parts: lowStock.data?.length || 0,
      revenue_this_month: totalRevenue,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getDashboard };
