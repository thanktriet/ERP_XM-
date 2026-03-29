const router = require('express').Router();
const {
  getPurchaseOrders,
  getActionRequired,
  getPurchaseOrderDetail,
  createPurchaseOrder,
  updatePurchaseOrder,
  updatePOStatus,
  createReceipt,
  addReceiptItems,
  acceptReceipt,
  getReceiptDetail,
  createPayment,
  getMonthlySummary,
} = require('../controllers/purchaseOrder.controller');

const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate }                 = require('../middleware/validate.middleware');
const {
  createPORules,
  updatePORules,
  createPOItemRules,
  createReceiptRules,
  acceptReceiptRules,
  createPaymentRules,
  listPOQueryRules,
} = require('../validators/purchaseOrder.validator');

router.use(authenticate);

// ─── Đơn nhập hàng ────────────────────────────────────────────────────────────
// Các route cố định đặt TRƯỚC /:id để tránh conflict
router.get('/action-required', getActionRequired);
router.get('/monthly-summary', authorize('admin','manager','accountant'), getMonthlySummary);

router.get('/',
  listPOQueryRules, validate,
  getPurchaseOrders);

router.post('/',
  authorize('admin','manager','warehouse'),
  createPORules, validate,
  createPurchaseOrder);

router.get('/:id',           getPurchaseOrderDetail);

router.put('/:id',
  authorize('admin','manager','warehouse'),
  updatePORules, validate,
  updatePurchaseOrder);

router.patch('/:id/status',
  authorize('admin','manager','warehouse'),
  updatePOStatus);

// ─── Thanh toán NCC ───────────────────────────────────────────────────────────
router.post('/:id/payments',
  authorize('admin','manager','accountant'),
  createPaymentRules, validate,
  createPayment);

// ─── Phiếu nhận hàng ──────────────────────────────────────────────────────────
router.post('/:id/receipts',
  authorize('admin','manager','warehouse'),
  createReceiptRules, validate,
  createReceipt);

// Routes phiếu nhận dùng /receipts/:receiptId (không dùng /:id để tránh nhầm)
router.get('/receipts/:receiptId',    getReceiptDetail);

router.post('/receipts/:receiptId/items',
  authorize('admin','manager','warehouse'),
  addReceiptItems);

router.patch('/receipts/:receiptId/accept',
  authorize('admin','manager','warehouse'),
  acceptReceiptRules, validate,
  acceptReceipt);

module.exports = router;
