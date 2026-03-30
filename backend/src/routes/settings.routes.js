const express = require('express');
const router  = express.Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const {
  getFees, updateFee, createFee, deleteFee,
  getServices, updateService, createService, deleteService,
} = require('../controllers/settings.controller');

// ── Phí cố định ──────────────────────────────────────────────────
router.get   ('/fees',          authenticate, getFees);
router.post  ('/fees',          authenticate, authorize('admin', 'manager'), createFee);
router.put   ('/fees/:id',      authenticate, authorize('admin', 'manager'), updateFee);
router.delete('/fees/:id',      authenticate, authorize('admin'), deleteFee);

// ── Dịch vụ đăng ký ──────────────────────────────────────────────
router.get   ('/services',      authenticate, getServices);
router.post  ('/services',      authenticate, authorize('admin', 'manager'), createService);
router.put   ('/services/:id',  authenticate, authorize('admin', 'manager'), updateService);
router.delete('/services/:id',  authenticate, authorize('admin'), deleteService);

module.exports = router;
