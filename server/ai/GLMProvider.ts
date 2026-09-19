/**
 * Bell24h-OS Enterprise Intelligence Infrastructure
 * Server-Side Zhipu AI GLM Provider Adapter
 *
 * Compatible with GLM/GLN API key configurations.
 * Consumes OpenAI-compatible endpoint at https://open.bigmodel.cn/api/paas/v4.
 * Credentials resolved strictly via ProviderManager.getCredential("glm").
 */

import { getCredential } from "./ProviderManager.js";
import type {
  TextRequest,
  JsonRequest,
  ProviderResult,
} from "./ProviderTypes.js";

export const DEFAULT_MODEL = "glm-4-flash";
const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const REQUEST_TIMEOUT_MS = 30000;

export async function generateText(req: TextRequest): Promise<ProviderResult<string>> {
  const { apiKey } = getCredential("glm");
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
    const response = await fetch(`${GLM_BASE_URL}/chat/completions`, {
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
        `GLM API error (${response.status}).`;
      throw new Error(message);
    }

    const text = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage;

    return {
      data: text,
      provider: "glm",
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
      throw new Error("GLM request timed out.");
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
    throw new Error("GLM provider returned unparseable JSON.");
  }

  return {
    ...textRes,
    data: parsed,
  };
}
