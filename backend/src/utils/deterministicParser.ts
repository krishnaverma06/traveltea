/**
 * Removes a trailing location/scope qualifier from a captured activity name:
 *   "osho ashram from day 2"      -> "osho ashram"
 *   "parvati hill on day 3"       -> "parvati hill"
 *   "amby valley from the trip"   -> "amby valley"
 * Leaves names that merely contain such words intact ("day trip to Lonavala").
 */
function stripScopeQualifier(raw: string): string {
  let name = raw.trim();

  // "... from|on|in day N"
  const dayQualifier = name.match(/^(.*?)[\s,]+(?:from|on|in|of)\s+day\s+\d+\s*$/i);
  if (dayQualifier) return dayQualifier[1].trim();

  // "... from|out of [the] itinerary|trip|plan|schedule|list"
  const scopeQualifier = name.match(
    /^(.*?)[\s,]+(?:from|out\s+of)\s+(?:the\s+|my\s+)?(?:itinerary|trip|plan|schedule|list)\s*$/i,
  );
  if (scopeQualifier) return scopeQualifier[1].trim();

  return name;
}

export class DeterministicCommandParser {
  /**
   * Attempts to parse a deterministic timeline edit command from the user's query.
   * If the command matches a known structural pattern (like "undo" or "move X to Day Y"),
   * it returns an array of structured mutations.
   * If it cannot confidently parse the command, it returns null, signaling a fallback to Gemini.
   */
  static parse(query: string): any[] | null {
    const text = query.trim().toLowerCase();

    // Undo / Redo
    if (text === 'undo' || text === 'undo my last change' || text === 'undo last change') {
      return [{ action: 'undo' }];
    }
    if (text === 'redo' || text === 'redo my last change' || text === 'redo last change') {
      return [{ action: 'redo' }];
    }

    // Delete <Activity>
    const deleteMatch = text.match(/^(?:delete|remove)\s+(.+)$/i);
    if (deleteMatch) {
      // Avoid falsely capturing complex intents (e.g. "delete this because it's too hectic")
      if (text.includes('because') || text.includes('if')) return null;

      // The capture group is greedy, so a perfectly normal phrasing like
      // "remove Osho Ashram from day 2" used to look for an activity literally
      // named "osho ashram from day 2" and report it as missing. Strip the
      // trailing scope qualifier before matching. The mutation engine keys
      // deletes on activityName alone, so the day is informational only.
      const activityName = stripScopeQualifier(deleteMatch[1]);
      if (!activityName) return null;

      return [{
        action: 'delete',
        activityName
      }];
    }

    // Move <Activity> to Day X [morning/afternoon/evening]
    const moveMatch = text.match(/^(?:move)\s+(.+?)\s+to\s+(day\s+\d+|tomorrow)(?:\s+(morning|afternoon|evening))?$/i);
    if (moveMatch) {
      const activityName = moveMatch[1].trim();
      const targetDayStr = moveMatch[2].trim();
      const targetTime = moveMatch[3] ? moveMatch[3].trim() : undefined;
      
      let toDay: number | 'tomorrow' = 'tomorrow';
      if (targetDayStr.startsWith('day ')) {
        toDay = parseInt(targetDayStr.replace('day ', ''));
      }

      return [{
        action: 'move',
        activityName,
        toDay,
        newTime: targetTime
      }];
    }

    // Swap Day X and Day Y
    const swapDayMatch = text.match(/^(?:swap)\s+day\s+(\d+)\s+and\s+day\s+(\d+)$/i);
    if (swapDayMatch) {
      return [{
        action: 'swap_days',
        day1: parseInt(swapDayMatch[1]),
        day2: parseInt(swapDayMatch[2])
      }];
    }

    // Rename <Old> to <New>
    const renameMatch = text.match(/^(?:rename|change)\s+(.+?)\s+to\s+(.+)$/i);
    if (renameMatch) {
      if (text.includes('because') || text.includes('if')) return null;

      // If it looks like a time change, e.g. "Change lunch to 1 PM"
      const timeRegex = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|hrs)\b/i;
      if (timeRegex.test(renameMatch[2])) {
        return [{
          action: 'change_time',
          activityName: renameMatch[1].trim(),
          newTime: renameMatch[2].trim()
        }];
      } else {
        return [{
          action: 'rename',
          activityName: renameMatch[1].trim(),
          newName: renameMatch[2].trim()
        }];
      }
    }

    // Add <Activity> to Day X [time]
    const addMatch = text.match(/^(?:add)\s+(.+?)\s+to\s+(day\s+\d+|tomorrow)(?:\s+(morning|afternoon|evening))?$/i);
    if (addMatch) {
      if (text.includes('because') || text.includes('if')) return null;

      const activityName = addMatch[1].trim();
      const targetDayStr = addMatch[2].trim();
      const targetTime = addMatch[3] ? addMatch[3].trim() : undefined;
      
      let toDay: number | 'tomorrow' = 'tomorrow';
      if (targetDayStr.startsWith('day ')) {
        toDay = parseInt(targetDayStr.replace('day ', ''));
      }

      return [{
        action: 'add',
        activityName,
        toDay,
        time: targetTime
      }];
    }

    // If it doesn't match strict deterministic formats, return null
    return null;
  }
}
