import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HybridSearchResult } from '../types/hybrid-search.types.js';
import { 
  RerankerConfig, 
  RerankedDocument,
  RerankMetrics
} from '../types/reranker.types.js';
import {
  RERANK_ENABLED,
  RERANK_TOP_K,
  RERANK_FINAL_RESULTS,
  RERANK_CONTENT_MAX_LENGTH,
  RERANK_TIMEOUT_MS,
  RERANK_INCLUDE_REASON,
  RERANK_FUSION_WEIGHT,
  RERANK_LLM_WEIGHT
} from '../types/reranker.constants.js';
import Logger from '../../utils/logger.js';
import { z } from 'zod';
import { StructuredOutputParser } from '@langchain/core/output_parsers';

const logger = new Logger('Reranker');

export class RerankerService {
  private static llm: ChatGoogleGenerativeAI | null = null;

  private static getLLM(): ChatGoogleGenerativeAI {
    if (!this.llm) {
      this.llm = new ChatGoogleGenerativeAI({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        temperature: 0,
        maxOutputTokens: 2048,
        apiKey: process.env.GEMINI_API_KEY,
      });
    }
    return this.llm;
  }

  /**
   * Evaluates candidate documents comparatively using a single batched LLM call.
   * Returns documents sorted by combined final score.
   */
  public static async rerank(
    candidates: HybridSearchResult[],
    userQuery: string,
    config: RerankerConfig = {}
  ): Promise<{ documents: RerankedDocument[]; metrics: RerankMetrics }> {
    const startTime = Date.now();
    const enabled = config.enabled ?? RERANK_ENABLED;
    
    // Fallback immediately if disabled or no candidates
    if (!enabled || candidates.length === 0) {
      return this.bypassReranking(candidates, config, startTime);
    }

    const topK = config.topK ?? RERANK_TOP_K;
    const finalResults = config.finalResults ?? RERANK_FINAL_RESULTS;
    const maxLength = config.contentMaxLength ?? RERANK_CONTENT_MAX_LENGTH;
    const timeoutMs = config.timeoutMs ?? RERANK_TIMEOUT_MS;
    const includeReason = config.includeReason ?? RERANK_INCLUDE_REASON;
    const fusionWeight = config.fusionWeight ?? RERANK_FUSION_WEIGHT;
    const llmWeight = config.llmWeight ?? RERANK_LLM_WEIGHT;

    // Take top K candidates for evaluation
    const evaluationSet = candidates.slice(0, topK);
    
    logger.info(`⚖️ Batched reranking started for ${evaluationSet.length} candidates...`);

    // Prepare JSON schema based on includeReason
    const itemSchema = z.object({
      id: z.string(),
      score: z.number().min(0).max(1),
      reason: includeReason ? z.string().optional() : z.undefined()
    });
    const schema = z.array(itemSchema);
    const parser = StructuredOutputParser.fromZodSchema(schema);
    const formatInstructions = parser.getFormatInstructions();

    // Construct batched prompt
    let candidatesText = '';
    evaluationSet.forEach((c) => {
      const doc = c.document;
      const id = doc._id?.toString() || 'unknown';
      const title = doc.title || 'Untitled';
      const sourceType = doc.sourceType;
      
      // Truncate chunk content
      let content = doc.content || '';
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '...';
      }

      candidatesText += `---
[Doc ID: ${id}]
Title: ${title}
Source Type: ${sourceType}
Content: ${content}
`;
    });

    const prompt = `You are an expert retrieval relevance scorer. 
Evaluate how relevant each candidate document is to the user's query.

USER QUERY:
"${userQuery}"

CANDIDATE DOCUMENTS:
${candidatesText}---

INSTRUCTIONS:
- These documents were retrieved for the exact same query. You MUST evaluate them comparatively against one another.
- Use the full scoring range from 0.0 to 1.0.
- Only assign scores near 1.0 to the absolute strongest, most directly relevant candidates.
- Assign significantly lower scores to weaker or tangentially relevant candidates to create clear separation.
- You must score EVERY document provided.

${formatInstructions}`;

    try {
      // Execute with strictly enforced timeout
      const llm = this.getLLM();
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Reranking API timeout')), timeoutMs);
      });

      const responsePromise = llm.invoke(prompt);

      // Race LLM vs Timeout
      const result = await Promise.race([responsePromise, timeoutPromise]);
      const jsonResponse = result.content as string;

      // Parse and validate using Zod
      const parsedScores = await parser.parse(jsonResponse);

      // Build lookup map for scores
      const scoreMap = new Map<string, { score: number; reason?: string }>();
      parsedScores.forEach(item => {
        scoreMap.set(item.id, { score: item.score, reason: item.reason });
      });

      // Apply scores and combine
      const reranked: RerankedDocument[] = evaluationSet.map(candidate => {
        const id = candidate.document._id?.toString() || 'unknown';
        const llmResult = scoreMap.get(id);
        const rerankScore = llmResult ? llmResult.score : 0;
        
        // Final Score Formula
        const finalScore = (fusionWeight * candidate.fusedScore) + (llmWeight * rerankScore);

        return {
          ...candidate,
          rerankScore,
          finalScore,
          rerankReason: llmResult?.reason
        };
      });

      // Sort by finalScore descending
      reranked.sort((a, b) => b.finalScore - a.finalScore);

      // Keep top N
      const finalDocuments = reranked.slice(0, finalResults);

      const rerankTimeMs = Date.now() - startTime;
      
      // Calculate metrics
      let minScore = Infinity;
      let maxScore = -Infinity;
      let sumScore = 0;
      
      finalDocuments.forEach(doc => {
        if (doc.finalScore < minScore) minScore = doc.finalScore;
        if (doc.finalScore > maxScore) maxScore = doc.finalScore;
        sumScore += doc.finalScore;
      });

      const metrics: RerankMetrics = {
        wasReranked: true,
        rerankTimeMs,
        candidatesScored: evaluationSet.length,
        finalReturned: finalDocuments.length,
        highestScore: finalDocuments.length > 0 ? maxScore : 0,
        lowestScore: finalDocuments.length > 0 ? minScore : 0,
        averageScore: finalDocuments.length > 0 ? sumScore / finalDocuments.length : 0
      };

      logger.info(
        `✅ Reranking complete in ${rerankTimeMs}ms. ` +
        `Scored: ${metrics.candidatesScored} | Avg Score: ${metrics.averageScore.toFixed(4)} | ` +
        `Highest: ${metrics.highestScore.toFixed(4)} | Lowest: ${metrics.lowestScore.toFixed(4)} | ` +
        `Final Returned: ${metrics.finalReturned}`
      );

      return { documents: finalDocuments, metrics };

    } catch (error: any) {
      logger.warn(`⚠️ Reranking failed (${error.message}). Falling back to Hybrid Search ordering.`);
      // Reset cached LLM instance so next call gets a fresh one
      this.llm = null;
      return this.bypassReranking(candidates, config, startTime, error.message);
    }
  }

  /**
   * Graceful fallback when reranking is disabled or fails.
   */
  private static bypassReranking(
    candidates: HybridSearchResult[],
    config: RerankerConfig,
    startTime: number,
    errorMessage?: string
  ): { documents: RerankedDocument[]; metrics: RerankMetrics } {
    const finalResults = config.finalResults ?? RERANK_FINAL_RESULTS;
    const fusionWeight = config.fusionWeight ?? RERANK_FUSION_WEIGHT;
    
    // We didn't get an LLM score, so llmWeight is effectively 0, and finalScore = fusionScore
    const fallbackDocuments: RerankedDocument[] = candidates.slice(0, finalResults).map(c => ({
      ...c,
      rerankScore: 0,
      finalScore: fusionWeight * c.fusedScore 
    }));

    const metrics: RerankMetrics = {
      wasReranked: false,
      rerankTimeMs: Date.now() - startTime,
      candidatesScored: 0,
      finalReturned: fallbackDocuments.length,
      highestScore: fallbackDocuments.length > 0 ? fallbackDocuments[0].finalScore : 0,
      lowestScore: fallbackDocuments.length > 0 ? fallbackDocuments[fallbackDocuments.length - 1].finalScore : 0,
      averageScore: 0,
      error: errorMessage
    };

    return { documents: fallbackDocuments, metrics };
  }
}
