/**
 * Bell24h-OS Enterprise Intelligence Infrastructure
 * Server-Side Alibaba Qwen (DashScope) Provider Adapter
 *
 * Consumes OpenAI-compatible endpoint at https://dashscope.aliyuncs.com/compatible-mode/v1.
 * Credentials resolved strictly via ProviderManager.getCredential("qwen").
 */

import { getCredential } from "./ProviderManager.js";
import type {
  TextRequest,
  JsonRequest,
  ProviderResult,
} from "./ProviderTypes.js";

export const DEFAULT_MODEL = "qwen-plus";
const QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const REQUEST_TIMEOUT_MS = 35000;

export async function generateText(req: TextRequest): Promise<ProviderResult<string>> {
  const { apiKey } = getCredential("qwen");
  const model = req.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt });
  }
  messages.push({ role: "user", content: req.prompt });

  try {
    const response = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2048,
      }),
      signal: controller.signal,
    });

    const data: any = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (data && typeof data === "object" && data.error?.message) ||
        `Qwen API error (${response.status}).`;
      throw new Error(message);
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage;

    return {
      data: text,
      provider: "qwen",
      model,
      latencyMs: Date.now() - startedAt,
      tokens: usage
        ? {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }
        : undefined,
    };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error("Qwen request timed out.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function generateJson<T>(req: JsonRequest): Promise<ProviderResult<T>> {
  const systemPrompt =
    (req.systemPrompt ? req.systemPrompt + "\n" : "") +
    "You must respond ONLY with valid JSON conforming to the requested schema. Do not include markdown codeblocks or explanation.";

  const textRes = await generateText({
    ...req,
    systemPrompt,
  });

  let parsed: T;
  try {
    const cleaned = textRes.data.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    parsed = JSON.parse(cleaned) as T;
  } catch {
    throw new Error("Qwen provider returned unparseable JSON.");
  }

  return {
    ...textRes,
    data: parsed,
  };
}
