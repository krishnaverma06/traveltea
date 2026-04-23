import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface IPendingBooking {
  type: "hotel" | "flight";
  destination?: string;
  options?: any[];
  awaitingConfirmation: boolean;
  createdAt: Date;
}

export interface IConversation extends Document {
  conversationId: string;
  user: mongoose.Types.ObjectId;
  messages: IMessage[];
  metadata: {
    destination?: string;
    dates?: {
      start?: string;
      end?: string;
    };
    budget?: number;
    travelers?: number;
  };
  itinerary?: any; // Will be structured in Phase 2
  // Phase 4: a durability/observability mirror of whatever booking the
  // LangGraph checkpointer thinks is mid-confirmation for this thread —
  // not the resume mechanism itself (that's the checkpointer's job), just
  // a way to track/display pending state and detect a stale mirror if the
  // in-process checkpointer ever loses it (e.g. a server restart).
  pendingBooking?: IPendingBooking | null;
  // Same purpose for the agent-driven trip-planning flow (Phase 18): a
  // mirror of whichever step that flow is paused on, so a reloaded page can
  // restore the card it was waiting on. Mixed, because the payload shape
  // differs per step (slot question / option list / payment panel).
  pendingTrip?: any | null;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const ConversationSchema = new Schema<IConversation>(
  {
    conversationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    messages: [MessageSchema],
    metadata: {
      destination: String,
      dates: {
        start: String,
        end: String,
      },
      budget: Number,
      travelers: Number,
    },
    itinerary: {
      type: Schema.Types.Mixed,
      default: null,
    },
    pendingBooking: {
      type: Schema.Types.Mixed,
      default: null,
    },
    pendingTrip: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);