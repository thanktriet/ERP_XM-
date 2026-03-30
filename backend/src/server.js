const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const authRoutes         = require('./routes/auth.routes');
const vehicleRoutes      = require('./routes/vehicle.routes');
const inventoryRoutes    = require('./routes/inventory.routes');
const customerRoutes     = require('./routes/customer.routes');
const salesRoutes        = require('./routes/sales.routes');
const warrantyRoutes     = require('./routes/warranty.routes');
const financeRoutes      = require('./routes/finance.routes');
const reportRoutes       = require('./routes/report.routes');
const accessoriesRoutes  = require('./routes/accessories.routes');
const uploadRoutes       = require('./routes/upload.routes');
const accountingRoutes   = require('./routes/accounting.routes');
const purchaseOrderRoutes = require('./routes/purchaseOrder.routes');
const { errorHandler, notFoundHandler } = require('./middleware/error.middleware');

const app = express();

// CORS: FRONTEND_URL có thể liệt kê nhiều origin, phân tách bằng dấu phẩy (local + GitHub Pages, v.v.)
const corsOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
// Tăng giới hạn JSON body lên 2MB (dùng cho các request thông thường)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'ERP Xe Máy Điện API đang hoạt động',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Routes
app.use('/api/auth',            authRoutes);
app.use('/api/vehicles',        vehicleRoutes);
app.use('/api/inventory',       inventoryRoutes);
app.use('/api/customers',       customerRoutes);
app.use('/api/sales',           salesRoutes);
app.use('/api/warranty',        warrantyRoutes);
app.use('/api/finance',         financeRoutes);
app.use('/api/reports',         reportRoutes);
app.use('/api/accessories',     accessoriesRoutes);
app.use('/api/upload',          uploadRoutes);
app.use('/api/accounting',      accountingRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);

// 404 & Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
  console.log(`📖 API Health: http://localhost:${PORT}/api/health`);
  console.log(`🌿 Môi trường: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
