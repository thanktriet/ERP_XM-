const router  = require('express').Router();
const multer  = require('multer');
const { getInventory, addVehicle, updateVehicle, deleteVehicle, getStockSummary, getSpareParts, getLowStockAlert } = require('../controllers/inventory.controller');
const { previewImport, confirmImport, downloadTemplate } = require('../controllers/inventoryImport.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

// Multer nhận file Excel (tối đa 10 MB, chỉ .xlsx/.xls)
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream',
    ].includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls)$/i);
    ok ? cb(null, true) : cb(new Error('Chỉ chấp nhận file Excel (.xlsx, .xls)'));
  },
}).single('file');

router.use(authenticate);

// ─── Import Excel (đặt TRƯỚC /:id để tránh conflict) ─────────────────────────
router.get('/import/template', downloadTemplate);
router.post('/import/preview',
  authorize('admin', 'manager', 'warehouse'),
  (req, res, next) => uploadExcel(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  }),
  previewImport,
);
router.post('/import/confirm',
  authorize('admin', 'manager', 'warehouse'),
  confirmImport,
);

// ─── CRUD thông thường ────────────────────────────────────────────────────────
router.get('/',            getInventory);
router.get('/summary',     getStockSummary);
router.get('/spare-parts', getSpareParts);
router.get('/low-stock',   getLowStockAlert);
router.post('/',           addVehicle);
router.put('/:id',         updateVehicle);
router.delete('/:id',      deleteVehicle);

module.exports = router;

