const router = require('express').Router();
const {
  getVehicleModels,
  getVehicleModelDetail,
  createVehicleModel,
  updateVehicleModel,
  deleteVehicleModel,
  getBrands,
} = require('../controllers/vehicle.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/brands', getBrands);
router.get('/', getVehicleModels);
router.get('/:id', getVehicleModelDetail);
router.post('/', createVehicleModel);
router.put('/:id', updateVehicleModel);
router.delete('/:id', deleteVehicleModel);

module.exports = router;
