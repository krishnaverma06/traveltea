const mongoose = require('mongoose');
require('dotenv').config();

async function checkDB() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');
  
  const savedTrips = await mongoose.connection.db.collection('savedtrips').find({}).toArray();
  console.log(`Total saved trips: ${savedTrips.length}`);
  
  const parisTrips = savedTrips.filter(t => 
    JSON.stringify(t).toLowerCase().includes('paris')
  );
  console.log(`Saved trips containing 'paris': ${parisTrips.length}`);
  if (parisTrips.length > 0) {
    console.log('Paris Trip from DB:', parisTrips[0].title || parisTrips[0]._id);
  }

  const vectorDocs = await mongoose.connection.db.collection('vectordocuments').find({ sourceType: 'user_trips' }).toArray();
  console.log(`Total vector docs (user_trips): ${vectorDocs.length}`);
  
  const parisVectors = vectorDocs.filter(d => 
    JSON.stringify(d).toLowerCase().includes('paris')
  );
  console.log(`Vector docs containing 'paris': ${parisVectors.length}`);
  
  mongoose.disconnect();
}

checkDB().catch(console.error);
