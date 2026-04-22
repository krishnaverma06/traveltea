import { Request, Response } from 'express';
import * as bookingService from '../services/bookingService.js';

/** The signed-in user's payment history, newest first. */
export const listTransactions = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);

    const result = await bookingService.listTransactions(req.userId, { page, limit });

    return res.json({
      transactions: result.transactions,
      pagination: { current: result.page, pages: result.pages, total: result.total },
    });
  } catch (error: any) {
    console.error('Failed to list transactions:', error);
    return res.status(500).json({ error: 'Failed to list transactions', details: error?.message });
  }
};
