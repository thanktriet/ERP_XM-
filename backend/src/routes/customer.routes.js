const router = require('express').Router();
const { getCustomers, createCustomer, getCustomerDetail, updateCustomer } = require('../controllers/customer.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createCustomerRules, updateCustomerRules } = require('../validators/customer.validator');

router.use(authenticate);
router.get('/', getCustomers);
router.post('/', createCustomerRules, validate, createCustomer);
router.get('/:id', getCustomerDetail);
router.put('/:id', updateCustomerRules, validate, updateCustomer);

module.exports = router;
