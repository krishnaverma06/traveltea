import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import SavedTrip from '../models/SavedTrip.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function testSave() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripwhat';
  await mongoose.connect(mongoUri);

  const payload = {
    user: new mongoose.Types.ObjectId(), // Fake user
    title: "Test Trip",
    description: "Test",
    startDate: new Date(),
    cities: [{ name: "Paris", days: 3 }],
    totalDays: 3,
    people: 2,
    travelType: "leisure",
    budget: {
      total: 5000,
      travel: 1000,
      accommodation: 2000,
      food: 1000,
      events: 1000,
      mode: "capped"
    },
    budgetMode: "capped",
    generatedItinerary: {
      days: [
        {
          dayNumber: 1,
          title: "Day 1",
          timeSlots: [
            {
              period: "morning",
              startTime: "09:00",
              endTime: "12:00",
              activities: [
                { name: "Eiffel Tower" }
              ]
            }
          ]
        }
      ],
      tripMetadata: {
        destination: "Paris",
        numberOfPeople: 2,
        travelers: 2,
        budget: {
          perDay: 1000,
          breakdown: { activities: 500, accommodation: 500, food: 0, travel: 0 }
        }
      }
    },
    tags: ["leisure", "Paris"]
  };

  try {
    const savedTrip = new SavedTrip(payload);
    await savedTrip.save();
    console.log("✅ Successfully saved test trip!");
    // Clean up
    await SavedTrip.deleteOne({ _id: savedTrip._id });
  } catch (err) {
    console.error("❌ Validation Error:", err.message);
    console.error(err.errors);
  }

  await mongoose.disconnect();
}

testSave().catch(console.error);
