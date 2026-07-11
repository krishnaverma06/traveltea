/**
 * Itinerary JSDoc Type Definitions for Traveltea Frontend
 * Documentation mapping to match backend structured persistence models.
 */

/**
 * @typedef {Object} TripMetadata
 * @property {string} destination
 * @property {string} [startDate]
 * @property {string} [endDate]
 * @property {number} duration
 * @property {string} [budget]
 * @property {number} [travelers]
 * @property {string[]} [preferences]
 */

/**
 * @typedef {Object} Activity
 * @property {string} id
 * @property {string} name
 * @property {Object} location
 * @property {number} location.lat
 * @property {number} location.lon
 * @property {string} [location.address]
 * @property {string} duration
 * @property {string} [estimatedCost]
 * @property {string} category
 * @property {string} [description]
 * @property {number} [rating]
 * @property {string} [imageUrl]
 * @property {string[]} [kinds]
 * @property {string} [xid]
 */

/**
 * @typedef {Object} TimeSlot
 * @property {'morning' | 'afternoon' | 'evening' | 'night'} period
 * @property {string} startTime
 * @property {string} endTime
 * @property {Activity[]} activities
 */

/**
 * @typedef {Object} DayPlan
 * @property {number} dayNumber
 * @property {string} [date]
 * @property {string} title
 * @property {string} [description]
 * @property {TimeSlot[]} timeSlots
 */

/**
 * @typedef {Object} Itinerary
 * @property {string} id
 * @property {TripMetadata} tripMetadata
 * @property {DayPlan[]} days
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

// Permitted placeholder export to prevent import resolution runtime crashes
export const ItinerarySchemaInfo = "Traveltea Data Type Configuration Context Loaded.";