const router = require('express').Router();
const { login, refresh, logout, getMe } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { loginRules } = require('../validators/auth.validator');

router.post('/login', loginRules, validate, login);
router.post('/refresh', refresh);          // Public — không cần authenticate
router.post('/logout', authenticate, logout);
router.get('/me', authenticate, getMe);

module.exports = router;
