/**
 * Server-side Gemini adapter.
 *
 * Credentials come from ProviderManager (process environment only). This module
 * must never be imported from `src/` (client code).
 */

import { GoogleGenAI, Type } from "@google/genai";
import { getCredential } from "./ProviderManager.js";

export const DEFAULT_MODEL = "gemini-3.6-flash";

export interface TextRequest {
  prompt: string;
  model?: string;
}

export interface JsonRequest extends TextRequest {
  responseSchema: unknown;
}

export interface ProviderResult<T> {
  data: T;
  model: string;
  latencyMs: number;
}

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

  const result = await client().models.generateContent({
    model,
    contents: req.prompt,
  });

  return { data: result.text ?? "", model, latencyMs: Date.now() - startedAt };
}

/** Schema-constrained JSON completion. Throws if the provider returns unparseable output. */
export async function generateJson<T>(req: JsonRequest): Promise<ProviderResult<T>> {
  const model = req.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const result = await client().models.generateContent({
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

  return { data: parsed, model, latencyMs: Date.now() - startedAt };
}

/** Re-exported so route handlers can declare schemas without importing the SDK directly. */
export { Type as SchemaType };
