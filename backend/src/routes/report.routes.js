const router = require('express').Router();
const { getDashboard } = require('../controllers/report.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/dashboard', getDashboard);

module.exports = router;
