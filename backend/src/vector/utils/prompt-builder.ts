import { IVectorDocument } from '../types/vector.types.js';

export class PromptBuilder {
  /**
   * Build a structured context block for the RAG prompt
   */
  public static buildRagContextPrompt(groupedResults: {
    userProfile: IVectorDocument[];
    userTrips: IVectorDocument[];
    globalKnowledge: IVectorDocument[];
    searchKnowledge: IVectorDocument[];
  }): string {
    const parts: string[] = [];

    // Header
    parts.push('---');
    parts.push('## RELEVANT SEMANTIC CONTEXT');
    parts.push('The following information has been retrieved from the Vector Knowledge Base to assist with your response.');
    parts.push('Use this context to personalize your answers and provide accurate travel data. Do not mention "semantic context" or "retrieved data" to the user, just answer naturally using this knowledge.');
    parts.push('');

    // User Profile
    if (groupedResults.userProfile.length > 0) {
      parts.push('### Relevant User Profile');
      groupedResults.userProfile.forEach(doc => {
        parts.push(doc.content);
      });
      parts.push('');
    }

    // Previous Trips
    if (groupedResults.userTrips.length > 0) {
      parts.push('### Relevant Previous Trips');
      groupedResults.userTrips.forEach(doc => {
        parts.push(`- **${doc.title}**: ${doc.content}`);
      });
      parts.push('');
    }

    // Global Knowledge
    if (groupedResults.globalKnowledge.length > 0) {
      parts.push('### Relevant Destination Knowledge');
      groupedResults.globalKnowledge.forEach(doc => {
        parts.push(`- **${doc.title}** (${doc.country}, ${doc.city}): ${doc.content}`);
      });
      parts.push('');
    }

    // Search Knowledge
    if (groupedResults.searchKnowledge.length > 0) {
      parts.push('### Relevant Search Knowledge');
      groupedResults.searchKnowledge.forEach(doc => {
        parts.push(`- **${doc.title}** (${doc.country}, ${doc.city}): ${doc.content}`);
      });
      parts.push('');
    }

    parts.push('---');
    return parts.join('\n');
  }
}
