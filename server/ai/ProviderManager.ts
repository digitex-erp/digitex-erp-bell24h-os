/**
 * Bell24h-OS Enterprise Intelligence Infrastructure
 * Server-Side Provider Credential Resolution & Provider Registry
 *
 * SECURITY CONTRACT:
 * Credentials are read ONLY from the server process environment. This module must
 * never read `public.ai_providers` (or any other tenant-readable table), because
 * those rows are selectable by any authenticated organization member and would
 * place provider keys within reach of the browser.
 *
 * This file must never be imported from `src/` (client code).
 */

import {
  ServerProviderName,
  ProviderMetadata,
} from "./ProviderTypes.js";

export type { ServerProviderName, ProviderMetadata };

export interface ProviderCredential {
  provider: ServerProviderName;
  apiKey: string;
  envVarUsed: string;
}

/** Thrown when a provider credential is not configured in the server environment. */
export class ProviderCredentialError extends Error {
  readonly code = "provider_credentials_unavailable";
  constructor(provider: ServerProviderName, envVars: string[]) {
    super(
      `Credentials for provider "${provider}" are not configured (checked ${envVars.join(", ")}).`
    );
    this.name = "ProviderCredentialError";
  }
}

/**
 * Maps providers to their primary and alias environment variables.
 * Accommodates verified Vercel environment naming (e.g. GLN_API_KEY and NINIMAX_API_KEY).
 */
const ENV_VARS_BY_PROVIDER: Record<ServerProviderName, string[]> = {
  gemini: ["GEMINI_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  qwen: ["QWEN_API_KEY"],
  glm: ["GLM_API_KEY", "GLN_API_KEY"],
  minimax: ["MINIMAX_API_KEY", "NINIMAX_API_KEY"],
};

/** Static registry of provider definitions, capabilities, and catalog defaults. */
export const PROVIDER_REGISTRY: Record<ServerProviderName, ProviderMetadata> = {
  gemini: {
    provider: "gemini",
    displayName: "Google Gemini",
    defaultModel: "gemini-1.5-flash",
    availableModels: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"],
    endpoint: "https://generativelanguage.googleapis.com",
    envVars: ["GEMINI_API_KEY"],
    capabilities: { text: true, json: true, reasoning: true, vision: true, streaming: true },
    timeoutMs: 30000,
  },
  nvidia: {
    provider: "nvidia",
    displayName: "NVIDIA NIM",
    defaultModel: "meta/llama-3.3-70b-instruct",
    availableModels: [
      "meta/llama-3.3-70b-instruct",
      "meta/llama-3.1-70b-instruct",
      "mistralai/mixtral-8x7b-instruct-v0.1",
    ],
    endpoint: "https://integrate.api.nvidia.com/v1",
    envVars: ["NVIDIA_API_KEY"],
    capabilities: { text: true, json: true, reasoning: true, vision: false, streaming: true },
    timeoutMs: 30000,
  },
  deepseek: {
    provider: "deepseek",
    displayName: "DeepSeek AI",
    defaultModel: "deepseek-chat",
    availableModels: ["deepseek-chat", "deepseek-reasoner"],
    endpoint: "https://api.deepseek.com/v1",
    envVars: ["DEEPSEEK_API_KEY"],
    capabilities: { text: true, json: true, reasoning: true, vision: false, streaming: true },
    timeoutMs: 45000,
  },
  qwen: {
    provider: "qwen",
    displayName: "Alibaba Qwen (DashScope)",
    defaultModel: "qwen-plus",
    availableModels: ["qwen-turbo", "qwen-plus", "qwen-max"],
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envVars: ["QWEN_API_KEY"],
    capabilities: { text: true, json: true, reasoning: true, vision: false, streaming: true },
    timeoutMs: 35000,
  },
  glm: {
    provider: "glm",
    displayName: "Zhipu AI (GLM)",
    defaultModel: "glm-4-flash",
    availableModels: ["glm-4-flash", "glm-4", "glm-4-plus"],
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    envVars: ["GLM_API_KEY", "GLN_API_KEY"],
    capabilities: { text: true, json: true, reasoning: false, vision: false, streaming: true },
    timeoutMs: 30000,
  },
  minimax: {
    provider: "minimax",
    displayName: "MiniMax AI",
    defaultModel: "MiniMax-Text-01",
    availableModels: ["MiniMax-Text-01", "abab6.5s-chat"],
    endpoint: "https://api.minimax.chat/v1",
    envVars: ["MINIMAX_API_KEY", "NINIMAX_API_KEY"],
    capabilities: { text: true, json: true, reasoning: false, vision: false, streaming: true },
    timeoutMs: 30000,
  },
};

/**
 * Resolve a provider credential from the server environment.
 * Evaluates canonical and alias environment variables in sequence.
 * Fails closed: throws rather than returning an invalid or partially configured credential.
 */
export function getCredential(provider: ServerProviderName): ProviderCredential {
  const envVars = ENV_VARS_BY_PROVIDER[provider];
  if (!envVars || envVars.length === 0) {
    throw new Error(`Unknown provider "${provider}"`);
  }

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value && value.trim().length > 0) {
      return { provider, apiKey: value.trim(), envVarUsed: envVar };
    }
  }

  throw new ProviderCredentialError(provider, envVars);
}

/** Non-throwing configuration probe for diagnostics. Never returns the secret value. */
export function isProviderConfigured(provider: ServerProviderName): boolean {
  const envVars = ENV_VARS_BY_PROVIDER[provider];
  if (!envVars) return false;
  return envVars.some((v) => {
    const val = process.env[v];
    return !!val && val.trim().length > 0;
  });
}

/** Returns a list of all providers that have valid credentials in the current environment. */
export function getConfiguredProviders(): ServerProviderName[] {
  const allProviders = Object.keys(PROVIDER_REGISTRY) as ServerProviderName[];
  return allProviders.filter(isProviderConfigured);
}

/** Returns the provider metadata catalog including live configuration status. */
export function getRegistryStatus(): Array<ProviderMetadata & { isConfigured: boolean; envVarUsed?: string }> {
  return (Object.keys(PROVIDER_REGISTRY) as ServerProviderName[]).map((provider) => {
    const meta = PROVIDER_REGISTRY[provider];
    const isConfigured = isProviderConfigured(provider);
    let envVarUsed: string | undefined;
    if (isConfigured) {
      try {
        const cred = getCredential(provider);
        envVarUsed = cred.envVarUsed;
      } catch {
        // probe failed closed
      }
    }
    return {
      ...meta,
      isConfigured,
      envVarUsed,
    };
  });
}
