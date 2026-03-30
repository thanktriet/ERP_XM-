const router = require('express').Router();
const {
  login, refresh, logout, getMe,
  getUsers, createUser, updateUser, toggleUser, changePassword,
} = require('../controllers/auth.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { loginRules } = require('../validators/auth.validator');

// ─── Auth cơ bản ──────────────────────────────────────────────────────────────
router.post('/login',   loginRules, validate, login);
router.post('/refresh', refresh);                        // Public
router.post('/logout',  authenticate, logout);
router.get('/me',       authenticate, getMe);

// ─── Quản lý nhân viên (admin/manager) ───────────────────────────────────────
router.get('/users',
  authenticate, authorize('admin', 'manager'),
  getUsers);

router.post('/users',
  authenticate, authorize('admin'),
  createUser);

router.put('/users/:id',
  authenticate, authorize('admin'),
  updateUser);

router.patch('/users/:id/toggle',
  authenticate, authorize('admin'),
  toggleUser);

router.put('/users/:id/password',
  authenticate, authorize('admin'),
  changePassword);

module.exports = router;
