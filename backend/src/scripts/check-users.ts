import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import SavedTrip from '../models/SavedTrip.js';
import User from '../models/User.js';

async function checkUsers() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripwhat';
  await mongoose.connect(mongoUri);

  const trips = await SavedTrip.find();
  
  console.log('\n=== SAVED TRIPS & THEIR USERS ===\n');
  for (const trip of trips) {
    let userDetails = { name: 'Unknown', email: 'Unknown', id: trip.user };
    
    if (trip.user) {
      const u = await User.findById(trip.user);
      if (u) {
        userDetails = { name: u.name, email: u.email, id: u._id };
      }
    }
    
    console.log(`🏖️  Trip Title : ${trip.title}`);
    console.log(`👤 User Name  : ${userDetails.name}`);
    console.log(`📧 User Email : ${userDetails.email}`);
    console.log(`🆔 User ID    : ${userDetails.id}`);
    console.log('-----------------------------------');
  }

  await mongoose.disconnect();
}

checkUsers().catch(console.error);
