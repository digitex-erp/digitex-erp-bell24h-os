/**
 * Bell24h-OS Enterprise Intelligence Infrastructure
 * Standardized AI Provider & Router Type Contracts
 */

export type ServerProviderName =
  | "gemini"
  | "nvidia"
  | "deepseek"
  | "qwen"
  | "glm"
  | "minimax";

export type RoutingPolicy =
  | "balanced"
  | "cost_optimized"
  | "latency_optimized"
  | "reasoning";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface ProviderCapabilities {
  text: boolean;
  json: boolean;
  reasoning: boolean;
  vision: boolean;
  streaming: boolean;
}

export interface ProviderMetadata {
  provider: ServerProviderName;
  displayName: string;
  defaultModel: string;
  availableModels: string[];
  endpoint: string;
  envVars: string[];
  capabilities: ProviderCapabilities;
  timeoutMs: number;
}

export interface TextRequest {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Router-derived abort signal bounding this one provider attempt (D4.3-A).
   * When present, adapters use it instead of building their own local timeout.
   * Absent for direct/internal callers that bypass the router.
   */
  signal?: AbortSignal;
}

export interface JsonRequest extends TextRequest {
  responseSchema: unknown;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderResult<T> {
  data: T;
  provider: ServerProviderName;
  model: string;
  latencyMs: number;
  tokens?: TokenUsage;
  fallbackFrom?: ServerProviderName;
}

export interface ProviderCircuitBreaker {
  provider: ServerProviderName;
  state: CircuitBreakerState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  cooldownUntil: number | null;
  tripReason?: string;
}

export interface RouterContext {
  userId: string;
  organizationId: string;
  requestId: string;
  action: string;
  /** Overall deadline for the whole fallback cascade, in ms (D4.3-A). Defaults inside the router if omitted. */
  deadlineMs?: number;
}

export interface RouterOptions extends TextRequest {
  preferredProvider?: ServerProviderName;
  policy?: RoutingPolicy;
  workflowType?: string;
  allowFallback?: boolean;
}

export interface RouterJsonOptions<T> extends RouterOptions {
  responseSchema: unknown;
}

export interface TelemetryRecord {
  id?: string;
  requestId: string;
  organizationId: string;
  userId: string;
  provider: ServerProviderName;
  model: string;
  policy: RoutingPolicy;
  workflowType?: string;
  latencyMs: number;
  tokens?: TokenUsage;
  status: "SUCCESS" | "ERROR";
  fallbackFrom?: ServerProviderName;
  errorMessage?: string;
  createdAt: string;
}
