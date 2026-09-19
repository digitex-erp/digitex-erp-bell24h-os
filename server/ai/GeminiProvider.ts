/**
 * Server-side Gemini adapter.
 *
 * Credentials come from ProviderManager (process environment only). This module
 * must never be imported from `src/` (client code).
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getCredential } from "./ProviderManager.js";
import type {
  TextRequest,
  JsonRequest,
  ProviderResult,
} from "./ProviderTypes.js";

export { TextRequest, JsonRequest, ProviderResult };
export const DEFAULT_MODEL = "gemini-1.5-flash";

function client() {
  const { apiKey } = getCredential("gemini");
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { "User-Agent": "bell24h-os-server" } },
  });
}

/** Plain text completion. */
export async function generateText(req: TextRequest): Promise<ProviderResult<string>> {
  const model = req.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const result: any = await client().models.generateContent({
    model,
    contents: req.prompt,
  });

  const usage = result.usageMetadata;

  return {
    data: result.text ?? "",
    provider: "gemini",
    model,
    latencyMs: Date.now() - startedAt,
    tokens: usage
      ? {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
        }
      : undefined,
  };
}

/** Schema-constrained JSON completion. Throws if the provider returns unparseable output. */
export async function generateJson<T>(req: JsonRequest): Promise<ProviderResult<T>> {
  const model = req.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const result: any = await client().models.generateContent({
    model,
    contents: req.prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: req.responseSchema as any,
    },
  });

  const raw = result.text ?? "";
  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch {
    throw new Error("Provider returned unparseable JSON.");
  }

  const usage = result.usageMetadata;

  return {
    data: parsed,
    provider: "gemini",
    model,
    latencyMs: Date.now() - startedAt,
    tokens: usage
      ? {
          promptTokens: usage.promptTokenCount || 0,
          completionTokens: usage.candidatesTokenCount || 0,
          totalTokens: usage.totalTokenCount || 0,
        }
      : undefined,
  };
}

/** Re-exported so route handlers can declare schemas without importing the SDK directly. */
export { Type as SchemaType };
