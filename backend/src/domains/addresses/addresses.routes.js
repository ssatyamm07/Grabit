import { Router } from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import * as ctrl from './addresses.controller.js';

const router = Router();

const geocodeRateLimit = rateLimit({
	windowMs: 60_000,
	max: 30,
});

router.use(authenticateToken);

router.get('/geocode/search', geocodeRateLimit, ctrl.geocodeSearch);
router.get('/geocode/reverse', geocodeRateLimit, ctrl.geocodeReverse);
router.get('/places/autocomplete', geocodeRateLimit, ctrl.placesAutocomplete);
router.get('/places/:placeId', geocodeRateLimit, ctrl.placeDetails);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.put('/:id/default', ctrl.setDefault);
router.get('/:id', ctrl.get);
router.put('/:id', ctrl.update);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
