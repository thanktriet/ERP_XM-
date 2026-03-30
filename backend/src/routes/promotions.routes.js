// promotions.routes.js — mount tại /api/promotions
'use strict';
const router = require('express').Router();
const {
  getPromotions,
  getPromoDetail,
  createPromo,
  updatePromo,
  togglePromo,
  getActivePromos,
  applyPromoToOrder,
  getPromoUsage,
  getPromoStats,
} = require('../controllers/promotions.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.use(authenticate);

// Thống kê nhanh
router.get('/stats',   getPromoStats);

// Danh sách KM đang hiệu lực (dùng trong POS — tất cả nhân viên sales)
router.get('/active',  getActivePromos);

// Lịch sử sử dụng
router.get('/usage',   getPromoUsage);

// CRUD chính — admin/manager quản lý
router.get('/',    getPromotions);
router.post('/',   authorize('admin', 'manager'), createPromo);
router.get('/:id', getPromoDetail);
router.put('/:id', authorize('admin', 'manager'), updatePromo);
router.patch('/:id/toggle', authorize('admin', 'manager'), togglePromo);

// Áp dụng KM vào đơn hàng — sales cũng được
router.post('/apply', authorize('admin', 'manager', 'sales'), applyPromoToOrder);

module.exports = router;
