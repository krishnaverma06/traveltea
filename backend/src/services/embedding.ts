/**
 * Embedding Service
 * Generates text embeddings via Google Gemini Embedding API
 * and builds searchable text summaries from saved trip data.
 *
 * Uses @langchain/google-genai (already installed) which handles
 * API versioning and model resolution automatically.
 */

import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// M0 free tier — keep dimensions low for storage efficiency
const OUTPUT_DIMENSIONS = 256;

let embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;

function getEmbeddingsModel(): GoogleGenerativeAIEmbeddings {
  if (!embeddingsInstance) {
    embeddingsInstance = new GoogleGenerativeAIEmbeddings({
      apiKey: process.env.GEMINI_API_KEY,
      modelName: 'gemini-embedding-2',
    });
  }
  return embeddingsInstance;
}

/**
 * Generate a vector embedding for the given text.
 * Returns a 256-dimensional vector (truncated from the model's native output).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = getEmbeddingsModel();
  const vector = await model.embedQuery(text);

  // Truncate to OUTPUT_DIMENSIONS for M0 storage efficiency
  return vector.slice(0, OUTPUT_DIMENSIONS);
}

/**
 * Build a rich text summary from a saved trip document.
 * This is the text that gets embedded for semantic search.
 */
export function buildTripSummary(tripDoc: any): string {
  const parts: string[] = [];

  // Travel type and destinations
  const cityNames = (tripDoc.cities || []).map((c: any) => {
    const dayStr = c.days === 1 ? '1 day' : `${c.days} days`;
    return `${c.name} (${dayStr})`;
  });
  const route = cityNames.join(' → ');

  if (tripDoc.travelType) {
    parts.push(`A ${tripDoc.travelType} trip to ${route}`);
  } else {
    parts.push(`Trip to ${route}`);
  }

  // People
  if (tripDoc.people) {
    parts.push(`for ${tripDoc.people} ${tripDoc.people === 1 ? 'person' : 'people'}`);
  }

  // Budget
  if (tripDoc.budget?.total) {
    const mode = tripDoc.budgetMode || 'capped';
    parts.push(`Budget: $${tripDoc.budget.total} (${mode})`);
  }

  // Total days
  if (tripDoc.totalDays) {
    parts.push(`${tripDoc.totalDays} days total`);
  }

  // Activities — extract from the generated itinerary
  const activities: string[] = [];
  const itinerary = tripDoc.generatedItinerary;
  if (itinerary?.days) {
    for (const day of itinerary.days) {
      if (day.title) activities.push(day.title);
      if (day.timeSlots) {
        for (const slot of day.timeSlots) {
          if (slot.activities) {
            for (const act of slot.activities) {
              if (act.name) activities.push(act.name);
            }
          }
        }
      }
    }
  }

  if (activities.length > 0) {
    // Cap at 30 activities to keep the summary reasonable
    const actList = [...new Set(activities)].slice(0, 30).join(', ');
    parts.push(`Activities include: ${actList}`);
  }

  // Tags
  if (tripDoc.tags?.length > 0) {
    parts.push(`Tags: ${tripDoc.tags.join(', ')}`);
  }

  // Title and description
  if (tripDoc.title) {
    parts.push(`Title: ${tripDoc.title}`);
  }
  if (tripDoc.description) {
    parts.push(tripDoc.description);
  }

  return parts.join('. ') + '.';
}

export const EMBEDDING_DIMENSIONS = OUTPUT_DIMENSIONS;
