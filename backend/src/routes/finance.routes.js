const router = require('express').Router();
const {
  getTransactions,
  createTransaction,
  getMonthlyRevenue,
  getFinanceSummary,
} = require('../controllers/finance.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createTransactionRules } = require('../validators/finance.validator');

router.use(authenticate);

router.get('/', getTransactions);
router.post('/', createTransactionRules, validate, createTransaction);
router.get('/monthly-revenue', getMonthlyRevenue);
router.get('/summary', getFinanceSummary);

module.exports = router;
