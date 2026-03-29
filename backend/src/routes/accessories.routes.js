const router = require('express').Router();
const {
  getAccessories,
  getAccessoryById,
  createAccessory,
  updateAccessory,
  toggleAccessory,
} = require('../controllers/accessories.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate }                = require('../middleware/validate.middleware');
const { createAccessoryRules, updateAccessoryRules } = require('../validators/accessories.validator');

// Tất cả route yêu cầu đăng nhập
router.use(authenticate);

// Đọc — tất cả nhân viên
router.get('/',    getAccessories);
router.get('/:id', getAccessoryById);

// Ghi — chỉ admin và manager
router.post('/', authorize('admin', 'manager'), createAccessoryRules, validate, createAccessory);
router.put('/:id', authorize('admin', 'manager'), updateAccessoryRules, validate, updateAccessory);
router.patch('/:id/toggle', authorize('admin', 'manager'), toggleAccessory);

module.exports = router;
