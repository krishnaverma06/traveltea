import 'dotenv/config';
import { TravelAgent } from './src/agents/travel-agent.js'; 
async function test() { 
  const agent = new TravelAgent(); 
  const res = await agent.chat('Shift Shanti Stupa to the evening, move the morning activity to the afternoon, and add rest in the morning.'); 
  console.log('RESPONSE:', JSON.stringify(res, null, 2)); 
  process.exit(0);
} 
test();
