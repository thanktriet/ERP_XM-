const { body, query, param } = require('express-validator');

// ─── Chứng từ kế toán ────────────────────────────────────────────────────────

const createVoucherRules = [
  body('branch_id')
    .notEmpty().withMessage('Chi nhánh không được để trống')
    .isUUID().withMessage('branch_id không hợp lệ'),
  body('voucher_type')
    .notEmpty().withMessage('Loại chứng từ không được để trống')
    .isIn(['receipt','payment','journal','sales_invoice','purchase_invoice',
           'inventory_in','inventory_out','intercompany','allocation'])
    .withMessage('Loại chứng từ không hợp lệ'),
  body('voucher_date')
    .notEmpty().withMessage('Ngày chứng từ không được để trống')
    .isDate().withMessage('Ngày chứng từ phải có định dạng YYYY-MM-DD'),
  body('fiscal_period_id')
    .notEmpty().withMessage('Kỳ kế toán không được để trống')
    .isUUID().withMessage('fiscal_period_id không hợp lệ'),
  body('description')
    .optional({ checkFalsy: true }).trim()
    .isLength({ max: 500 }).withMessage('Diễn giải không quá 500 ký tự'),
  body('customer_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('customer_id không hợp lệ'),
  body('supplier_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('supplier_id không hợp lệ'),
  body('reference_type')
    .optional({ checkFalsy: true }).trim(),
  body('reference_id')
    .optional({ checkFalsy: true }).isUUID().withMessage('reference_id không hợp lệ'),
  body('lines')
    .isArray({ min: 2 }).withMessage('Chứng từ cần ít nhất 2 dòng bút toán'),
  body('lines.*.account_id')
    .notEmpty().withMessage('Tài khoản kế toán không được để trống')
    .isUUID().withMessage('account_id dòng bút toán không hợp lệ'),
  body('lines.*.debit_amount')
    .isInt({ min: 0 }).withMessage('Số tiền Nợ phải là số nguyên không âm'),
  body('lines.*.credit_amount')
    .isInt({ min: 0 }).withMessage('Số tiền Có phải là số nguyên không âm'),
  body('lines.*.description')
    .optional({ checkFalsy: true }).trim(),
];

// ─── Kỳ kế toán ─────────────────────────────────────────────────────────────

const createFiscalPeriodRules = [
  body('year')
    .notEmpty().withMessage('Năm không được để trống')
    .isInt({ min: 2020, max: 2099 }).withMessage('Năm phải từ 2020 đến 2099'),
  body('month')
    .notEmpty().withMessage('Tháng không được để trống')
    .isInt({ min: 1, max: 12 }).withMessage('Tháng phải từ 1 đến 12'),
];

const closePeriodRules = [
  body('status')
    .notEmpty()
    .isIn(['closed','locked']).withMessage('Trạng thái chỉ được là closed hoặc locked'),
];

// ─── Tài khoản kế toán ───────────────────────────────────────────────────────

const createAccountRules = [
  body('account_code')
    .notEmpty().withMessage('Mã tài khoản không được để trống').trim()
    .matches(/^\d{3,10}$/).withMessage('Mã tài khoản chỉ gồm 3-10 chữ số'),
  body('account_name')
    .notEmpty().withMessage('Tên tài khoản không được để trống').trim(),
  body('account_type')
    .notEmpty()
    .isIn(['asset','liability','equity','revenue','cogs','expense',
           'other_income','other_expense'])
    .withMessage('Loại tài khoản không hợp lệ'),
  body('normal_balance')
    .notEmpty()
    .isIn(['debit','credit']).withMessage('Số dư thường phải là debit hoặc credit'),
  body('level')
    .optional()
    .isInt({ min: 1, max: 5 }).withMessage('Cấp tài khoản phải từ 1 đến 5'),
  body('parent_code')
    .optional({ checkFalsy: true }).trim(),
  body('is_detail')
    .optional().isBoolean(),
];

const updateAccountRules = [
  body('account_name').optional().notEmpty().trim(),
  body('is_active').optional().isBoolean(),
  body('is_detail').optional().isBoolean(),
  body('description').optional({ checkFalsy: true }).trim(),
];

// ─── Nhà cung cấp ────────────────────────────────────────────────────────────

const createSupplierRules = [
  body('supplier_name')
    .notEmpty().withMessage('Tên nhà cung cấp không được để trống').trim(),
  body('phone')
    .optional({ checkFalsy: true })
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email')
    .optional({ checkFalsy: true }).isEmail().normalizeEmail()
    .withMessage('Email không hợp lệ'),
  body('tax_code')
    .optional({ checkFalsy: true }).trim()
    .isLength({ min: 10, max: 14 }).withMessage('Mã số thuế 10-14 ký tự'),
  body('payment_terms')
    .optional()
    .isInt({ min: 0, max: 365 }).withMessage('Số ngày thanh toán từ 0 đến 365'),
  body('credit_limit')
    .optional()
    .isInt({ min: 0 }).withMessage('Hạn mức tín dụng phải là số không âm'),
];

const updateSupplierRules = [
  body('supplier_name').optional().notEmpty().trim(),
  body('phone').optional({ checkFalsy: true })
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('payment_terms').optional().isInt({ min: 0, max: 365 }),
  body('credit_limit').optional().isInt({ min: 0 }),
  body('is_active').optional().isBoolean(),
];

// ─── Query chung ─────────────────────────────────────────────────────────────

const listQueryRules = [
  query('page').optional().isInt({ min: 1 }).withMessage('page phải >= 1'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('limit từ 1-200'),
];

module.exports = {
  createVoucherRules,
  createFiscalPeriodRules,
  closePeriodRules,
  createAccountRules,
  updateAccountRules,
  createSupplierRules,
  updateSupplierRules,
  listQueryRules,
};
