/**
 * User Profile Knowledge Service
 *
 * Automatically aggregates a user's trips and search behavior into a single
 * USER_PROFILE semantic document. This enables highly personalized RAG retrieval
 * by matching destinations and styles against the user's inferred preferences.
 *
 * Runs asynchronously (fire-and-forget).
 */

import SavedTrip from '../../models/SavedTrip.js';
import { VectorDocument } from '../models/VectorDocument.js';
import { VectorDocumentCategory, KnowledgeSourceType } from '../types/vector.types.js';
import { generateContentHash } from '../utils/content.utils.js';
import { inferBudgetTier } from '../utils/metadata.utils.js';
import { generateDocumentEmbedding } from './vector-embedding.service.js';
import Logger from '../../utils/logger.js';

const logger = new Logger('UserProfileKnowledge');

/**
 * Update the user's semantic profile based on their saved trips.
 * Call this whenever a user saves, updates, or deletes a trip.
 */
export async function updateUserProfileKnowledge(userId: string): Promise<void> {
  try {
    // 1. Fetch all trips for the user
    const trips = await SavedTrip.find({ user: userId });

    if (trips.length === 0) {
      // If no trips, remove the profile
      await VectorDocument.findOneAndDelete({
        userId,
        sourceType: KnowledgeSourceType.USER_PROFILE,
      });
      return;
    }

    // 2. Aggregate Preferences
    const countries = new Map<string, number>();
    const cities = new Map<string, number>();
    const travelStyles = new Map<string, number>();
    const budgetTiers = new Map<string, number>();
    let totalDays = 0;

    trips.forEach((trip: any) => {
      if (trip.travelType) {
        travelStyles.set(trip.travelType, (travelStyles.get(trip.travelType) || 0) + 1);
      }
      if (trip.budget) {
        const tier = inferBudgetTier(trip.budget);
        budgetTiers.set(tier, (budgetTiers.get(tier) || 0) + 1);
      }
      totalDays += trip.totalDays || 0;

      if (trip.cities) {
        trip.cities.forEach((c: any) => {
          if (c.name) cities.set(c.name, (cities.get(c.name) || 0) + 1);
          if (c.country) countries.set(c.country, (countries.get(c.country) || 0) + 1);
        });
      }
    });

    const topCountries = Array.from(countries.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 3);
    const topCities = Array.from(cities.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 5);
    const topStyles = Array.from(travelStyles.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const topBudgets = Array.from(budgetTiers.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const avgDuration = Math.round(totalDays / trips.length);

    // 3. Build Profile Content
    const profileParts = [
      `User Profile Summary.`,
      `Total trips saved: ${trips.length}.`,
      `Preferred travel styles: ${topStyles.join(', ')}.`,
      `Preferred budget tiers: ${topBudgets.join(', ')}.`,
      `Average trip duration: ${avgDuration} days.`,
    ];

    if (topCountries.length > 0) {
      profileParts.push(`Frequently visited countries: ${topCountries.join(', ')}.`);
    }
    if (topCities.length > 0) {
      profileParts.push(`Favorite cities: ${topCities.join(', ')}.`);
    }

    const content = profileParts.join('\n');
    const contentHash = generateContentHash(content);

    // 4. Check for existing profile to avoid redundant embedding
    const existingProfile = await VectorDocument.findOne({
      userId,
      sourceType: KnowledgeSourceType.USER_PROFILE,
    });

    let embedding = existingProfile?.embedding;

    if (!existingProfile || existingProfile.contentHash !== contentHash) {
      logger.debug(`User profile changed for user ${userId}, generating new embedding...`);
      embedding = await generateDocumentEmbedding({
        title: `Travel Profile - User ${userId}`,
        category: VectorDocumentCategory.GUIDE, // Generic category for profiles
        country: 'Global',
        city: 'Global',
        content,
        source: 'user_profile_aggregator',
      });
    }

    // 5. Upsert Document
    await VectorDocument.findOneAndUpdate(
      { userId, sourceType: KnowledgeSourceType.USER_PROFILE },
      {
        $set: {
          title: `Travel Profile - User ${userId}`,
          category: VectorDocumentCategory.GUIDE,
          country: 'Global',
          city: 'Global',
          content,
          contentHash,
          embedding,
          source: 'user_profile_aggregator',
          privacy: 'private',
          relatedCountries: topCountries,
          relatedDestinations: topCities,
          relatedTripStyles: topStyles,
          metadata: {
            travelTypes: topStyles,
            budgetTier: topBudgets[0] || 'Standard',
            durationCategory: `${avgDuration} days avg`,
          }
        },
      },
      { upsert: true, new: true }
    );

    logger.info(`User profile knowledge updated for user: ${userId}`);
  } catch (error: any) {
    logger.error(`User profile update failed for user ${userId}: ${error.message}`);
  }
}
