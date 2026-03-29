const router = require('express').Router();
const {
  getDashboard,
  getFiscalPeriods, createFiscalPeriod, updatePeriodStatus,
  getAccounts, createAccount, updateAccount,
  getSuppliers, createSupplier, updateSupplier, getSupplierDetail,
  getVouchers, getVoucherDetail, createVoucher, postVoucher, reverseVoucher,
  getTrialBalance, getGeneralLedger, getAROutstanding,
  getAmisSyncStatus, retryAmisSyncItem,
} = require('../controllers/accounting.controller');

const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate }                 = require('../middleware/validate.middleware');
const {
  createVoucherRules,
  createFiscalPeriodRules,
  closePeriodRules,
  createAccountRules,
  updateAccountRules,
  createSupplierRules,
  updateSupplierRules,
} = require('../validators/accounting.validator');

// Toàn bộ routes kế toán cần xác thực
router.use(authenticate);

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard', getDashboard);

// ─── Kỳ kế toán ──────────────────────────────────────────────────────────────
router.get('/periods',                getFiscalPeriods);
router.post('/periods',
  authorize('admin','manager','accountant'),
  createFiscalPeriodRules, validate,
  createFiscalPeriod);
router.patch('/periods/:id/status',
  authorize('admin','manager','accountant'),
  closePeriodRules, validate,
  updatePeriodStatus);

// ─── Hệ thống tài khoản ───────────────────────────────────────────────────────
router.get('/accounts',               getAccounts);
router.post('/accounts',
  authorize('admin','accountant'),
  createAccountRules, validate,
  createAccount);
router.put('/accounts/:id',
  authorize('admin','accountant'),
  updateAccountRules, validate,
  updateAccount);

// ─── Nhà cung cấp ─────────────────────────────────────────────────────────────
router.get('/suppliers',              getSuppliers);
router.get('/suppliers/:id',          getSupplierDetail);
router.post('/suppliers',
  authorize('admin','manager','accountant'),
  createSupplierRules, validate,
  createSupplier);
router.put('/suppliers/:id',
  authorize('admin','manager','accountant'),
  updateSupplierRules, validate,
  updateSupplier);

// ─── Chứng từ kế toán ─────────────────────────────────────────────────────────
router.get('/vouchers',               getVouchers);
router.get('/vouchers/:id',           getVoucherDetail);
router.post('/vouchers',
  authorize('admin','manager','accountant'),
  createVoucherRules, validate,
  createVoucher);
router.patch('/vouchers/:id/post',
  authorize('admin','accountant'),
  postVoucher);
router.post('/vouchers/:id/reverse',
  authorize('admin','accountant'),
  reverseVoucher);

// ─── Báo cáo ──────────────────────────────────────────────────────────────────
router.get('/trial-balance',          authorize('admin','manager','accountant'), getTrialBalance);
router.get('/general-ledger',         authorize('admin','manager','accountant'), getGeneralLedger);
router.get('/ar-outstanding',         authorize('admin','manager','accountant','sales'), getAROutstanding);

// ─── Đồng bộ AMIS ─────────────────────────────────────────────────────────────
router.get('/amis-sync',              authorize('admin','accountant'), getAmisSyncStatus);
router.post('/amis-sync/:queueId/retry',
  authorize('admin','accountant'),
  retryAmisSyncItem);

module.exports = router;
