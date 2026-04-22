import { Router } from 'express';
import auth from '../middleware/auth.js';
import { listTransactions } from '../controllers/transactionController.js';

const router = Router();

router.use(auth);

// Mounted at /api/transactions rather than /api/bookings/transactions, which
// the existing GET /api/bookings/:id would otherwise swallow as an :id.
router.get('/', listTransactions);

export default router;
