import SavedTrip from "../models/SavedTrip.js";
import { logger } from "../utils/logger.js";

export class MutationValidationError extends Error {
  public code: string;
  public suggestions: string[];

  constructor(message: string, code: string, suggestions: string[] = []) {
    super(message);
    this.name = 'MutationValidationError';
    this.code = code;
    this.suggestions = suggestions;
  }
}

/**
 * A dedicated service for mutating SavedTrip timelines chronologically.
 * Tracks revisions for undo support, manages optimistic locking and idempotency.
 */
export class TimelineMutationEngine {
  
  static async applyMutations(
    savedTripId: string, 
    mutations: any[], 
    timelineVersion?: number, 
    mutationId?: string, 
    aiSummary?: string
  ) {
    const trip: any = await SavedTrip.findById(savedTripId);
    if (!trip) {
      throw new MutationValidationError(`SavedTrip not found for id: ${savedTripId}`, 'NOT_FOUND');
    }

    if (!trip.timeline) trip.timeline = {};
    if (typeof trip.timeline.version !== 'number') trip.timeline.version = 0;
    if (typeof trip.timeline.currentRevisionIndex !== 'number') trip.timeline.currentRevisionIndex = -1;
    if (!trip.timeline.revisions) trip.timeline.revisions = [];

    // Idempotency Check
    if (mutationId) {
      const existingRevision = trip.timeline.revisions.find((r: any) => r.mutationId === mutationId);
      if (existingRevision) {
        logger.info(`[Idempotency] Duplicate mutation detected: ${mutationId}`);
        return { status: 'duplicate', trip, cachedSummary: existingRevision.aiSummary };
      }
    }

    // Handle Undo / Redo directly if they are the sole operations
    if (mutations.length === 1 && mutations[0].action === 'undo') {
      return this.undo(trip, mutationId, aiSummary);
    }
    if (mutations.length === 1 && mutations[0].action === 'redo') {
      return this.redo(trip, mutationId, aiSummary);
    }

    // Optimistic Locking Check
    if (timelineVersion !== undefined && trip.timeline.version !== timelineVersion) {
      throw new MutationValidationError(
        "This itinerary has changed since you opened it. Please refresh before making more edits.",
        "VERSION_MISMATCH"
      );
    }

    // Save before state
    const beforeState = JSON.parse(JSON.stringify(trip.generatedItinerary));

    // Validate and process mutations
    for (const mutation of mutations) {
      this.validateMutation(trip, mutation);
      this.processMutation(trip, mutation);
    }

    // Save after state
    const afterState = JSON.parse(JSON.stringify(trip.generatedItinerary));

    // Update revision history (slice any redo-able future history)
    const currentIdx = trip.timeline.currentRevisionIndex;
    if (currentIdx < trip.timeline.revisions.length - 1) {
      trip.timeline.revisions = trip.timeline.revisions.slice(0, currentIdx + 1);
    }

    trip.timeline.revisions.push({
      timestamp: new Date(),
      mutationId: mutationId || `gen_${Date.now()}`,
      action: mutations.map(m => m.action).join(','),
      before: beforeState,
      after: afterState,
      aiSummary: aiSummary || 'Applied timeline edits.'
    });

    if (trip.timeline.revisions.length > 200) {
      trip.timeline.revisions.shift(); // Keep history bounded
    } else {
      trip.timeline.currentRevisionIndex = trip.timeline.revisions.length - 1;
    }

    trip.timeline.version += 1;
    trip.timeline.lastUpdated = new Date();
    
    await trip.save();
    return { status: 'success', trip };
  }

  private static async undo(trip: any, mutationId?: string, aiSummary?: string) {
    if (trip.timeline.currentRevisionIndex < 0 || trip.timeline.revisions.length === 0) {
       throw new MutationValidationError("Nothing to undo.", "CANNOT_UNDO");
    }

    const currentRev = trip.timeline.revisions[trip.timeline.currentRevisionIndex];
    trip.generatedItinerary = currentRev.before;
    trip.timeline.currentRevisionIndex -= 1;
    trip.timeline.version += 1;
    trip.timeline.lastUpdated = new Date();
    await trip.save();
    return { status: 'success', trip, aiSummary: 'Undid last change.' };
  }

  private static async redo(trip: any, mutationId?: string, aiSummary?: string) {
    if (trip.timeline.currentRevisionIndex >= trip.timeline.revisions.length - 1) {
      throw new MutationValidationError("Nothing to redo.", "CANNOT_REDO");
    }

    trip.timeline.currentRevisionIndex += 1;
    const nextRev = trip.timeline.revisions[trip.timeline.currentRevisionIndex];
    trip.generatedItinerary = nextRev.after;
    trip.timeline.version += 1;
    trip.timeline.lastUpdated = new Date();
    await trip.save();
    return { status: 'success', trip, aiSummary: 'Redid last change.' };
  }

  private static validateMutation(trip: any, mutation: any) {
    const { action } = mutation;
    
    // Helper to check activity existence
    const checkActivity = (nameOrId: string) => {
      if (!nameOrId) return;
      const loc = this.findActivityAndLocation(trip, nameOrId);
      if (!loc) {
        throw new MutationValidationError(
          `I couldn't find '${nameOrId}' in this itinerary.`,
          "ACTIVITY_NOT_FOUND",
          this.getAllActivityNames(trip)
        );
      }
    };

    // Helper to check day existence
    const checkDay = (dayNum: number) => {
      if (!dayNum) return;
      const day = trip.generatedItinerary.days.find((d: any) => d.dayNumber === dayNum);
      if (!day) {
        throw new MutationValidationError(
          `This itinerary does not contain Day ${dayNum}.`,
          "DAY_OUT_OF_BOUNDS"
        );
      }
    };

    switch(action) {
      case 'move':
      case 'move_activity':
        checkActivity(mutation.activityId || mutation.activityName);
        if (mutation.toDay !== 'tomorrow') checkDay(mutation.toDay);
        break;
      case 'delete':
      case 'remove_activity':
        checkActivity(mutation.activityId || mutation.activityName);
        break;
      case 'swap_activities':
        checkActivity(mutation.activityId1 || mutation.activityName1);
        checkActivity(mutation.activityId2 || mutation.activityName2);
        break;
      case 'swap_days':
        checkDay(mutation.day1);
        checkDay(mutation.day2);
        break;
      case 'rename':
      case 'change_time':
        checkActivity(mutation.activityId || mutation.activityName);
        break;
    }
  }

  private static processMutation(trip: any, mutation: any) {
    const { action } = mutation;
    logger.info(`[MutationEngine] Applying mutation: ${action}`, { savedTripId: trip._id, mutation });

    switch (action) {
      case 'move':
      case 'move_activity':
        this.handleMoveActivity(trip, mutation);
        break;
      case 'delete':
      case 'remove_activity':
        this.handleRemoveActivity(trip, mutation);
        break;
      case 'add':
      case 'add_activity':
        this.handleAddActivity(trip, mutation);
        break;
      case 'swap_activities':
        this.handleSwapActivities(trip, mutation);
        break;
      case 'swap_days':
        this.handleSwapDays(trip, mutation);
        break;
      case 'rename':
        this.handleRenameActivity(trip, mutation);
        break;
      case 'change_time':
        this.handleChangeTime(trip, mutation);
        break;
      case 'replace':
        this.handleReplaceActivity(trip, mutation);
        break;
      default:
        logger.warn(`Unsupported mutation action: ${action}`);
    }
  }

  private static findActivityAndLocation(trip: any, activityIdOrName: string) {
    for (let dIdx = 0; dIdx < trip.generatedItinerary.days.length; dIdx++) {
      const day = trip.generatedItinerary.days[dIdx];
      for (let tIdx = 0; tIdx < day.timeSlots.length; tIdx++) {
        const slot = day.timeSlots[tIdx];
        for (let aIdx = 0; aIdx < slot.activities.length; aIdx++) {
          const activity = slot.activities[aIdx];
          if (activity.id === activityIdOrName || activity.name.toLowerCase() === activityIdOrName.toLowerCase()) {
            return { activity, dayIndex: dIdx, slotIndex: tIdx, activityIndex: aIdx };
          }
        }
      }
    }
    return null;
  }

  private static getAllActivityNames(trip: any): string[] {
    const names = [];
    for (const day of trip.generatedItinerary.days) {
      for (const slot of day.timeSlots) {
        for (const act of slot.activities) {
          names.push(act.name);
        }
      }
    }
    return names;
  }

  private static handleRemoveActivity(trip: any, mutation: any) {
    const loc = this.findActivityAndLocation(trip, mutation.activityId || mutation.activityName);
    if (loc) {
      trip.generatedItinerary.days[loc.dayIndex].timeSlots[loc.slotIndex].activities.splice(loc.activityIndex, 1);
    }
  }

  private static handleMoveActivity(trip: any, mutation: any) {
    const loc = this.findActivityAndLocation(trip, mutation.activityId || mutation.activityName);
    if (!loc) return;

    // Remove from old slot
    const [activity] = trip.generatedItinerary.days[loc.dayIndex].timeSlots[loc.slotIndex].activities.splice(loc.activityIndex, 1);

    // Find new day
    const newDay = trip.generatedItinerary.days.find((d: any) => d.dayNumber === mutation.toDay);
    if (!newDay) return; // Tomorrow logic could be handled if we resolve 'tomorrow' to dayNumber earlier

    // Find new slot by period or approximate time
    let targetSlot = newDay.timeSlots.find((s: any) => s.period.toLowerCase() === (mutation.newTime || '').toLowerCase());
    if (!targetSlot && newDay.timeSlots.length > 0) {
      targetSlot = newDay.timeSlots[0]; // fallback
    }

    if (targetSlot) {
      targetSlot.activities.push(activity);
    }
  }

  private static handleAddActivity(trip: any, mutation: any) {
    const newDay = trip.generatedItinerary.days.find((d: any) => d.dayNumber === mutation.toDay);
    if (!newDay) return;

    let targetSlot = newDay.timeSlots.find((s: any) => s.period.toLowerCase() === (mutation.time || '').toLowerCase());
    if (!targetSlot && newDay.timeSlots.length > 0) {
      targetSlot = newDay.timeSlots[0];
    }

    if (targetSlot) {
      targetSlot.activities.push({
        id: `custom_${Date.now()}`,
        name: mutation.activityName || 'New Activity',
        description: mutation.description || '',
        category: mutation.category || 'custom'
      });
    }
  }

  private static handleSwapActivities(trip: any, mutation: any) {
    const loc1 = this.findActivityAndLocation(trip, mutation.activityId1 || mutation.activityName1);
    const loc2 = this.findActivityAndLocation(trip, mutation.activityId2 || mutation.activityName2);

    if (loc1 && loc2) {
      const act1 = trip.generatedItinerary.days[loc1.dayIndex].timeSlots[loc1.slotIndex].activities[loc1.activityIndex];
      const act2 = trip.generatedItinerary.days[loc2.dayIndex].timeSlots[loc2.slotIndex].activities[loc2.activityIndex];

      trip.generatedItinerary.days[loc1.dayIndex].timeSlots[loc1.slotIndex].activities[loc1.activityIndex] = act2;
      trip.generatedItinerary.days[loc2.dayIndex].timeSlots[loc2.slotIndex].activities[loc2.activityIndex] = act1;
    }
  }

  private static handleSwapDays(trip: any, mutation: any) {
    const dayIndex1 = trip.generatedItinerary.days.findIndex((d: any) => d.dayNumber === mutation.day1);
    const dayIndex2 = trip.generatedItinerary.days.findIndex((d: any) => d.dayNumber === mutation.day2);
    
    if (dayIndex1 !== -1 && dayIndex2 !== -1) {
      // Swap the timeSlots of the two days
      const slots1 = trip.generatedItinerary.days[dayIndex1].timeSlots;
      const slots2 = trip.generatedItinerary.days[dayIndex2].timeSlots;
      
      trip.generatedItinerary.days[dayIndex1].timeSlots = slots2;
      trip.generatedItinerary.days[dayIndex2].timeSlots = slots1;
    }
  }

  private static handleRenameActivity(trip: any, mutation: any) {
    const loc = this.findActivityAndLocation(trip, mutation.activityId || mutation.activityName);
    if (loc) {
      trip.generatedItinerary.days[loc.dayIndex].timeSlots[loc.slotIndex].activities[loc.activityIndex].name = mutation.newName;
    }
  }

  private static handleChangeTime(trip: any, mutation: any) {
     const loc = this.findActivityAndLocation(trip, mutation.activityId || mutation.activityName);
     if (loc) {
        // Find or create slot based on mutation.newTime (for now move to different period slot if possible)
        const [activity] = trip.generatedItinerary.days[loc.dayIndex].timeSlots[loc.slotIndex].activities.splice(loc.activityIndex, 1);
        
        let targetSlot = trip.generatedItinerary.days[loc.dayIndex].timeSlots.find((s: any) => 
           s.period.toLowerCase().includes(mutation.newTime.toLowerCase()) || 
           mutation.newTime.toLowerCase().includes(s.period.toLowerCase())
        );
        
        if (!targetSlot) {
            targetSlot = trip.generatedItinerary.days[loc.dayIndex].timeSlots[0]; 
        }
        targetSlot.activities.push(activity);
     }
  }

  private static handleReplaceActivity(trip: any, mutation: any) {
    const loc = this.findActivityAndLocation(trip, mutation.activityId || mutation.activityName);
    if (loc) {
      trip.generatedItinerary.days[loc.dayIndex].timeSlots[loc.slotIndex].activities[loc.activityIndex] = {
        id: `custom_${Date.now()}`,
        name: mutation.newActivityName || 'New Activity',
        description: mutation.description || '',
        category: mutation.category || 'custom'
      };
    }
  }
}
