import { Request, Response } from 'express';
import * as bookingService from '../services/bookingService.js';
import { BookingNotFoundError, PaymentInProgressError, BookingNotPayableError } from '../services/bookingService.js';
import mongoose from 'mongoose';


/**
 * A malformed :id used to reach Mongoose and throw a CastError, which the
 * catch-all turned into a 500. Bad client input is a 400.
 */
const invalidId = (id: string, res: Response): boolean => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'Invalid booking id' });
    return true;
  }
  return false;
};

export const createBooking = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const { type, option, request } = req.body;

    if (!type || !['hotel', 'flight'].includes(type)) {
      return res.status(400).json({ error: "Missing or invalid required field: type ('hotel'|'flight')" });
    }
    if (!option || !option.name || !option.priceNote) {
      return res.status(400).json({ error: 'Missing required field: option (must include name, priceNote)' });
    }
    if (!request || !request.destination) {
      return res.status(400).json({ error: 'Missing required field: request.destination' });
    }

    const booking = await bookingService.createBooking(req.userId, {
      type,
      option,
      request,
      // Never trust a client-supplied source — only bookingExecuteNode
      // (the AI chat path) may produce source: 'chat'.
      source: 'web',
    });

    return res.status(201).json({ message: 'Booking created', booking });
  } catch (error: any) {
    console.error('Error creating booking:', error);
    return res.status(500).json({ error: 'Failed to create booking', details: error.message });
  }
};

export const listBookings = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const { page = 1, limit = 10 } = req.query;
    const result = await bookingService.listBookings(req.userId, {
      page: parseInt(page as string, 10),
      limit: parseInt(limit as string, 10),
    });

    return res.json({
      bookings: result.bookings,
      pagination: { current: result.page, pages: result.pages, total: result.total },
    });
  } catch (error: any) {
    console.error('Error listing bookings:', error);
    return res.status(500).json({ error: 'Failed to list bookings', details: error.message });
  }
};

export const getBooking = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const { id } = req.params;
    if (invalidId(id, res)) return;
    const result = await bookingService.getBooking(id, req.userId);

    if (!result) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    return res.json(result);
  } catch (error: any) {
    console.error('Error fetching booking:', error);
    return res.status(500).json({ error: 'Failed to fetch booking', details: error.message });
  }
};

export const payBooking = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const { id } = req.params;
    if (invalidId(id, res)) return;

    // `method` is optional so the original card-only body still works — the
    // chat path and any existing client keep functioning unchanged.
    const method: string = req.body?.method || 'card';
    let payment: bookingService.PaymentInput;

    if (method === 'card') {
      const { cardholderName, cardNumber, expiryMonth, expiryYear, cvv } = req.body;
      if (!cardholderName || !cardNumber || !expiryMonth || !expiryYear || !cvv) {
        return res.status(400).json({
          error: 'Missing required fields: cardholderName, cardNumber, expiryMonth, expiryYear, cvv',
        });
      }
      payment = { method: 'card', card: { cardholderName, cardNumber, expiryMonth, expiryYear, cvv } };
    } else if (method === 'upi') {
      if (!req.body?.upiId) {
        return res.status(400).json({ error: 'Missing required field: upiId' });
      }
      payment = { method: 'upi', upiId: String(req.body.upiId) };
    } else if (method === 'netbanking') {
      if (!req.body?.bank) {
        return res.status(400).json({ error: 'Missing required field: bank' });
      }
      payment = { method: 'netbanking', bank: String(req.body.bank) };
    } else {
      return res.status(400).json({
        error: `Unsupported payment method "${method}". Use card, upi or netbanking.`,
      });
    }

    const result = await bookingService.submitPayment(id, req.userId, payment);

    if (result.alreadyPaid) {
      return res.json({ message: 'Booking already paid', booking: result.booking, transaction: result.transaction });
    }

    return res.json({
      message: result.transaction.status === 'succeeded' ? 'Payment successful' : 'Payment declined',
      status: result.transaction.status === 'succeeded' ? 'confirmed' : 'payment_failed',
      booking: result.booking,
      transaction: result.transaction,
    });
  } catch (error: any) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof PaymentInProgressError || error instanceof BookingNotPayableError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('Error processing payment:', error);
    return res.status(500).json({ error: 'Failed to process payment', details: error.message });
  }
};

export const cancelBooking = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const { id } = req.params;
    if (invalidId(id, res)) return;
    const booking = await bookingService.cancelBooking(id, req.userId);

    return res.json({ message: 'Booking cancelled', booking });
  } catch (error: any) {
    if (error instanceof BookingNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof BookingNotPayableError) {
      return res.status(409).json({ error: error.message });
    }
    console.error('Error cancelling booking:', error);
    return res.status(500).json({ error: 'Failed to cancel booking', details: error.message });
  }
};
