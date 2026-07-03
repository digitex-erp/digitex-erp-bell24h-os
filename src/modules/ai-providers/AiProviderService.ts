export type AIProviderName = 
  | "Gemini"
  | "NVIDIA"
  | "MiniMax"
  | "Qwen"
  | "DeepSeek"
  | "GLM"
  | "OpenAI"
  | "Claude";

export interface AIProviderConfig {
  name: AIProviderName;
  priority: number;
  apiKey: string;
  model: string;
  rateLimit: number;
  failover: boolean;
  retry: number;
  timeout: number;
  isActive: boolean;
}

export abstract class BaseAIProvider {
  protected config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  abstract generateText(prompt: string): Promise<string>;
  abstract checkHealth(): Promise<boolean>;

  get isOperational(): boolean {
    return this.config.isActive;
  }
}

export class GeminiProvider extends BaseAIProvider {
  async generateText(prompt: string): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error("Gemini API key is missing");
    }
    // Placeholder implementation for Gemini using the abstraction layer
    console.log(`[Gemini] Generating text with model ${this.config.model}`);
    return Promise.resolve(`[Gemini] Mock response for: ${prompt}`);
  }

  async checkHealth(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

// Future providers architecture ready
export class OpenAIProvider extends BaseAIProvider {
  async generateText(prompt: string): Promise<string> {
    throw new Error("Method not implemented.");
  }
  async checkHealth(): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
}

export class AnthropicProvider extends BaseAIProvider {
  async generateText(prompt: string): Promise<string> {
    throw new Error("Method not implemented.");
  }
  async checkHealth(): Promise<boolean> {
    throw new Error("Method not implemented.");
  }
}

// AI Router for managing multiple providers, failovers and retries
export class AIManager {
  private providers: Map<AIProviderName, BaseAIProvider> = new Map();

  registerProvider(provider: BaseAIProvider) {
    // @ts-ignore
    this.providers.set(provider.config.name, provider);
  }

  async generate(prompt: string): Promise<string> {
    const sortedProviders = Array.from(this.providers.values())
      .filter(p => p.isOperational)
      // @ts-ignore
      .sort((a, b) => a.config.priority - b.config.priority);

    if (sortedProviders.length === 0) {
      throw new Error("No active AI providers available");
    }

    // Try providers in priority order (Failover support)
    for (const provider of sortedProviders) {
      try {
        return await provider.generateText(prompt);
      } catch (error) {
        console.warn(`Provider ${(provider as any).config.name} failed, trying next...`, error);
        // If failover is disabled, throw immediately
        // @ts-ignore
        if (!provider.config.failover) {
          throw error;
        }
      }
    }

    throw new Error("All AI providers failed");
  }
}
