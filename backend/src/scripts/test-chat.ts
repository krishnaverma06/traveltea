import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import { travelAgent } from '../agents/travel-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function testChat() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tripwhat';
  await mongoose.connect(mongoUri);

  const queries = [
    "Find me hotels in Paris",
    "Find flights to London",
    "What is the distance between Tokyo and Kyoto?",
    "Plan a trip to Rome for 3 days"
  ];

  for (const q of queries) {
    console.log(`\n\n======================================`);
    console.log(`TESTING QUERY: "${q}"`);
    console.log(`======================================`);
    try {
      const res = await travelAgent.chat(q, "test-conv");
      console.log("RESPONSE:", res.response);
    } catch (e) {
      console.error("❌ ERROR for query", q, e);
    }
  }

  await mongoose.disconnect();
}

testChat().catch(console.error);
