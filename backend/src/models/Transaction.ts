import mongoose, { Schema, Document } from 'mongoose';

export type TransactionStatus = 'succeeded' | 'failed';

// Explicitly never stored: full card number, CVV — masked-only, even though
// this is entirely fake/simulated data. Modeling real PCI-conscious behavior
// is good practice and costs nothing here.
/**
 * Masked snapshot of how the payment was made. Never holds a PAN, CVV or UPI
 * PIN — only what a receipt needs to show.
 *
 * `brand`/`last4` are no longer required because they are card-only; a UPI or
 * netbanking payment has neither. `type` defaults to 'card' so the rows written
 * before this field existed still read correctly (Mongoose validates on write,
 * not on read, and every historical row was a card payment).
 */
const paymentMethodSnapshotSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['card', 'upi', 'netbanking'],
      required: true,
      default: 'card',
    },
    brand: { type: String },   // card only
    last4: { type: String },   // card only
    upiId: { type: String },   // upi only — the handle, e.g. name@bank
    bank: { type: String },    // netbanking only
  },
  { _id: false }
);

export interface ITransaction extends Document {
  transactionId: string;
  booking: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  amount: number | null;
  currency: string | null;
  status: TransactionStatus;
  paymentMethod: {
    type: 'card' | 'upi' | 'netbanking';
    brand?: string;
    last4?: string;
    upiId?: string;
    bank?: string;
  };
  failureReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    // Denormalized alongside `booking` so a user's transaction history can be
    // queried directly without a join.
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, default: null },
    currency: { type: String, default: null },
    status: { type: String, enum: ['succeeded', 'failed'], required: true },
    paymentMethod: { type: paymentMethodSnapshotSchema, required: true },
    failureReason: { type: String, default: null },
  },
  { timestamps: true }
);

TransactionSchema.index({ booking: 1, createdAt: -1 });
TransactionSchema.index({ user: 1, createdAt: -1 });

export const Transaction = mongoose.model<ITransaction>('Transaction', TransactionSchema);
