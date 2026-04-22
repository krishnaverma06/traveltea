/**
 * Agent configuration
 */
export interface AgentConfig {
  modelName?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}
