const router = require('express').Router();
const {
  createOrder,
  getOrders,
  getOrderDetail,
  updateOrderStatus,
} = require('../controllers/sales.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createOrderRules, updateOrderStatusRules } = require('../validators/sales.validator');

router.use(authenticate);

router.get('/', getOrders);
router.post('/', createOrderRules, validate, createOrder);
router.get('/:id', getOrderDetail);
router.patch('/:id/status', updateOrderStatusRules, validate, updateOrderStatus);

module.exports = router;
