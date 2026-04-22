import mongoose, { Schema, Document } from 'mongoose';

export type BookingType = 'hotel' | 'flight';
export type BookingStatus = 'pending_payment' | 'confirmed' | 'failed' | 'cancelled';
export type BookingSource = 'chat' | 'web';

// Denormalized snapshots of BookingOption/BookingRequest (agents/booking-pipeline.ts)
// — search results aren't persisted anywhere else, so a Booking record must be
// self-contained rather than referencing data that could disappear/change.
const bookingOptionSnapshotSchema = new Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ['hotel', 'flight'], required: true },
    name: { type: String, required: true },
    location: {
      latitude: Number,
      longitude: Number,
    },
    rating: Number,
    category: [String],
    image: String,
    price: {
      amount: String,
      currency: String,
    },
    priceNote: String,
  },
  { _id: false }
);

const bookingRequestSnapshotSchema = new Schema(
  {
    type: { type: String, enum: ['hotel', 'flight'], required: true },
    destination: { type: String, required: true },
    origin: String,
    checkIn: String,
    checkOut: String,
    departDate: String,
    returnDate: String,
    guests: Number,
    confirmed: Boolean,
  },
  { _id: false }
);

export interface IBooking extends Document {
  bookingReference: string;
  user: mongoose.Types.ObjectId;
  type: BookingType;
  status: BookingStatus;
  option: any;
  request: any;
  source: BookingSource;
  conversationId?: string | null;
  // Concurrency guard only — not a business-facing status. See bookingService's
  // submitPayment for how this closes the double-submit race on POST /:id/pay.
  paymentInFlight: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSchema = new Schema<IBooking>(
  {
    bookingReference: { type: String, required: true, unique: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['hotel', 'flight'], required: true },
    status: {
      type: String,
      enum: ['pending_payment', 'confirmed', 'failed', 'cancelled'],
      default: 'pending_payment',
      index: true,
    },
    option: { type: bookingOptionSnapshotSchema, required: true },
    request: { type: bookingRequestSnapshotSchema, required: true },
    source: { type: String, enum: ['chat', 'web'], required: true },
    conversationId: { type: String, default: null },
    paymentInFlight: { type: Boolean, default: false },
  },
  { timestamps: true }
);

BookingSchema.index({ user: 1, createdAt: -1 });

export const Booking = mongoose.model<IBooking>('Booking', BookingSchema);
