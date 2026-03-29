const { body } = require('express-validator');

const createCustomerRules = [
  body('full_name').notEmpty().withMessage('Họ tên không được để trống').trim(),
  body('phone')
    .notEmpty().withMessage('Số điện thoại không được để trống')
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
  body('customer_type')
    .optional()
    .isIn(['individual', 'business']).withMessage('Loại khách hàng không hợp lệ'),
  body('id_card').optional({ checkFalsy: true }).trim(),
  body('date_of_birth').optional({ checkFalsy: true }).isDate().withMessage('Ngày sinh không hợp lệ (YYYY-MM-DD)'),
  body('address').optional({ checkFalsy: true }).trim(),
  body('province').optional({ checkFalsy: true }).trim(),
  body('district').optional({ checkFalsy: true }).trim(),
  body('company_name').optional({ checkFalsy: true }).trim(),
  body('tax_code').optional({ checkFalsy: true }).trim(),
  body('notes').optional({ checkFalsy: true }).trim(),
];

const updateCustomerRules = [
  body('full_name').optional().notEmpty().withMessage('Họ tên không được để trống').trim(),
  body('phone')
    .optional()
    .matches(/^(0|\+84)[0-9]{8,10}$/).withMessage('Số điện thoại không hợp lệ'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
  body('customer_type')
    .optional()
    .isIn(['individual', 'business']).withMessage('Loại khách hàng không hợp lệ'),
  body('id_card').optional({ checkFalsy: true }).trim(),
  body('date_of_birth').optional({ checkFalsy: true }).isDate().withMessage('Ngày sinh không hợp lệ (YYYY-MM-DD)'),
  body('address').optional({ checkFalsy: true }).trim(),
  body('province').optional({ checkFalsy: true }).trim(),
  body('district').optional({ checkFalsy: true }).trim(),
  body('company_name').optional({ checkFalsy: true }).trim(),
  body('tax_code').optional({ checkFalsy: true }).trim(),
  body('notes').optional({ checkFalsy: true }).trim(),
];

module.exports = { createCustomerRules, updateCustomerRules };
