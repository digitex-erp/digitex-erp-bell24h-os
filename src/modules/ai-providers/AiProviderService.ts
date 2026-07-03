import { supabase } from "@/lib/supabase";

export type AIProviderName = "gemini" | "openai" | "anthropic" | "nvidia" | "minimax" | "deepseek" | "qwen" | "glm";

export interface AIProviderConfig {
  id: string;
  name: string;
  provider_id: AIProviderName;
  status: string;
  priority: number;
  api_key: string;
  default_model: string;
  temperature: number;
  max_tokens: number;
  timeout_ms: number;
  retry_count: number;
}

export abstract class BaseAIProvider {
  protected config: AIProviderConfig;
  
  constructor(config: AIProviderConfig) {
    this.config = config;
  }
  
  abstract generateText(prompt: string): Promise<{ text: string, promptTokens: number, completionTokens: number, totalTokens: number, latencyMs: number }>;
  abstract checkHealth(): Promise<boolean>;
  
  get isOperational(): boolean {
    return this.config.status === 'ACTIVE';
  }
  
  get providerConfig(): AIProviderConfig {
    return this.config;
  }
}

export class GeminiProvider extends BaseAIProvider {
  async generateText(prompt: string) {
    if (!this.config.api_key) throw new Error(`${this.config.name} API key is missing`);
    
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout_ms);
    
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.config.default_model}:generateContent?key=${this.config.api_key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: this.config.temperature,
            maxOutputTokens: this.config.max_tokens,
          }
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || "Gemini API Error");
      }
      
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const promptTokens = data.usageMetadata?.promptTokenCount || 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
      
      return {
        text,
        promptTokens,
        completionTokens,
        totalTokens: data.usageMetadata?.totalTokenCount || (promptTokens + completionTokens),
        latencyMs: Date.now() - start
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async checkHealth(): Promise<boolean> {
    return true; // Simple health check
  }
}

export class OpenAIProvider extends BaseAIProvider {
  async generateText(prompt: string) {
    if (!this.config.api_key) throw new Error(`${this.config.name} API key is missing`);
    
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout_ms);
    
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.api_key}`
        },
        body: JSON.stringify({
          model: this.config.default_model,
          messages: [{ role: "user", content: prompt }],
          temperature: this.config.temperature,
          max_tokens: this.config.max_tokens,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || "OpenAI API Error");
      }
      
      return {
        text: data.choices?.[0]?.message?.content || "",
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: Date.now() - start
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }
}

export class AnthropicProvider extends BaseAIProvider {
  async generateText(prompt: string) {
    if (!this.config.api_key) throw new Error(`${this.config.name} API key is missing`);
    
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout_ms);
    
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config.api_key,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.config.default_model,
          messages: [{ role: "user", content: prompt }],
          temperature: this.config.temperature,
          max_tokens: this.config.max_tokens,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || "Anthropic API Error");
      }
      
      return {
        text: data.content?.[0]?.text || "",
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        latencyMs: Date.now() - start
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }
}

// Open-compatible APIs (DeepSeek, Qwen, GLM, MiniMax, NVIDIA NIM) often use an OpenAI-compatible endpoint
export class OpenCompatibleProvider extends BaseAIProvider {
  private baseUrl: string;
  
  constructor(config: AIProviderConfig, baseUrl: string) {
    super(config);
    this.baseUrl = baseUrl;
  }
  
  async generateText(prompt: string) {
    if (!this.config.api_key) throw new Error(`${this.config.name} API key is missing`);
    
    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout_ms);
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.api_key}`
        },
        body: JSON.stringify({
          model: this.config.default_model,
          messages: [{ role: "user", content: prompt }],
          temperature: this.config.temperature,
          max_tokens: this.config.max_tokens,
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error?.message || `${this.config.name} API Error`);
      }
      
      return {
        text: data.choices?.[0]?.message?.content || "",
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        latencyMs: Date.now() - start
      };
    } catch (e: any) {
      clearTimeout(timeoutId);
      throw e;
    }
  }

  async checkHealth(): Promise<boolean> {
    return true;
  }
}

export class AIManagerService {
  private static instance: AIManagerService;
  
  private constructor() {}
  
  public static getInstance(): AIManagerService {
    if (!AIManagerService.instance) {
      AIManagerService.instance = new AIManagerService();
    }
    return AIManagerService.instance;
  }
  
  private createProviderInstance(config: AIProviderConfig): BaseAIProvider {
    switch (config.provider_id) {
      case 'gemini': return new GeminiProvider(config);
      case 'openai': return new OpenAIProvider(config);
      case 'anthropic': return new AnthropicProvider(config);
      case 'deepseek': return new OpenCompatibleProvider(config, "https://api.deepseek.com/v1");
      case 'qwen': return new OpenCompatibleProvider(config, "https://dashscope.aliyuncs.com/compatible-mode/v1");
      case 'glm': return new OpenCompatibleProvider(config, "https://open.bigmodel.cn/api/paas/v4");
      case 'minimax': return new OpenCompatibleProvider(config, "https://api.minimax.chat/v1");
      case 'nvidia': return new OpenCompatibleProvider(config, "https://integrate.api.nvidia.com/v1");
      default: return new OpenAIProvider(config); // Fallback assumption
    }
  }
  
  async getProviders(organizationId: string): Promise<BaseAIProvider[]> {
    const { data: providersData, error } = await supabase
      .from('ai_providers')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('status', 'ACTIVE')
      .order('priority', { ascending: true });
      
    if (error || !providersData) {
      console.error("Failed to fetch AI providers:", error);
      return [];
    }
    
    return providersData.map(config => this.createProviderInstance(config as AIProviderConfig));
  }
  
  async logRequest(logData: {
    provider_id: string;
    model: string;
    prompt: string;
    response: string;
    tokens_used: number;
    prompt_tokens: number;
    completion_tokens: number;
    latency_ms: number;
    status: string;
    error_message?: string;
    organization_id: string;
    created_by: string;
  }): Promise<string | undefined> {
    try {
      const { data } = await supabase.from('ai_request_logs').insert(logData).select('id').single();
      return data?.id;
    } catch (err) {
      console.error("Failed to log AI request:", err);
      return undefined;
    }
  }

  async generate(prompt: string, userId: string): Promise<{ text: string, logId?: string }> {
    // Get user's org
    const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', userId).single();
    if (!profile?.organization_id) {
      throw new Error("User has no organization context");
    }
    
    const orgId = profile.organization_id;
    const providers = await this.getProviders(orgId);
    
    if (providers.length === 0) {
      throw new Error("No active AI providers available for this organization");
    }
    
    // Try providers in priority order
    for (const provider of providers) {
      const config = provider.providerConfig;
      
      try {
        let attempts = 0;
        let success = false;
        let response;
        
        while (attempts <= config.retry_count && !success) {
          try {
            response = await provider.generateText(prompt);
            success = true;
          } catch (retryErr: any) {
            attempts++;
            if (attempts > config.retry_count) throw retryErr;
            await new Promise(r => setTimeout(r, 1000 * attempts)); // Exponential-ish backoff
          }
        }
        
        if (success && response) {
          // Log success
          const logId = await this.logRequest({
            provider_id: config.id,
            model: config.default_model,
            prompt,
            response: response.text,
            tokens_used: response.totalTokens,
            prompt_tokens: response.promptTokens,
            completion_tokens: response.completionTokens,
            latency_ms: response.latencyMs,
            status: 'SUCCESS',
            organization_id: orgId,
            created_by: userId
          });
          
          return { text: response.text, logId };
        }
      } catch (error: any) {
        console.warn(`Provider ${config.name} failed, trying next...`, error);
        
        // Log error
        await this.logRequest({
          provider_id: config.id,
          model: config.default_model,
          prompt,
          response: "",
          tokens_used: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          latency_ms: 0,
          status: 'ERROR',
          error_message: error.message || String(error),
          organization_id: orgId,
          created_by: userId
        });
        
        // Update provider status to track last error
        await supabase.from('ai_providers')
          .update({ last_error: error.message || String(error) })
          .eq('id', config.id);
          
        // Continue to next provider (Failover)
      }
    }
    
    throw new Error("All AI providers failed to generate a response");
  }
}
