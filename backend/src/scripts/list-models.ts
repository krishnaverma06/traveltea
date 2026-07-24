import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const key = process.env.GEMINI_API_KEY;
console.log('API Key prefix:', key?.substring(0, 6) + '...');

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
const data = await res.json();

if (data.error) {
  console.error('API Error:', data.error.message);
  process.exit(1);
}

const embModels = (data.models || []).filter(
  (m) => m.supportedGenerationMethods?.includes('embedContent')
);

if (embModels.length > 0) {
  console.log('\n✅ Available embedding models:');
  embModels.forEach((m) => console.log(`  - ${m.name}`));
} else {
  console.log('\n❌ No embedding models found. Showing all models:');
  (data.models || []).forEach((m) =>
    console.log(`  - ${m.name} [${(m.supportedGenerationMethods || []).join(', ')}]`)
  );
}
