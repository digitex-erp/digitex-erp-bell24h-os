/**
 * Bell24h-OS Enterprise Intelligence Infrastructure
 * Server-Side MiniMax Provider Adapter
 *
 * Compatible with MINIMAX/NINIMAX API key configurations.
 * Consumes OpenAI-compatible endpoint at https://api.minimax.chat/v1.
 * Credentials resolved strictly via ProviderManager.getCredential("minimax").
 */

import { getCredential } from "./ProviderManager.js";
import type {
  TextRequest,
  JsonRequest,
  ProviderResult,
} from "./ProviderTypes.js";

export const DEFAULT_MODEL = "MiniMax-Text-01";
const MINIMAX_BASE_URL = "https://api.minimax.chat/v1";
const REQUEST_TIMEOUT_MS = 30000;

export async function generateText(req: TextRequest): Promise<ProviderResult<string>> {
  const { apiKey } = getCredential("minimax");
  const model = req.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  // D4.3-A: a router-supplied signal (bounded by the shared request deadline)
  // takes precedence over this adapter's own fixed timeout. Direct/internal
  // callers that bypass the router (no signal supplied) keep today's behavior.
  const controller = req.signal ? undefined : new AbortController();
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : undefined;

  const messages: Array<{ role: string; content: string }> = [];
  if (req.systemPrompt) {
    messages.push({ role: "system", content: req.systemPrompt });
  }
  messages.push({ role: "user", content: req.prompt });

  try {
    const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
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
      signal: req.signal ?? controller!.signal,
    });

    const data: any = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        (data && typeof data === "object" && (data.error?.message || data.base_resp?.status_msg)) ||
        `MiniMax API error (${response.status}).`;
      throw new Error(message);
    }

    const text = data?.choices?.[0]?.message?.content ?? data?.reply ?? "";
    const usage = data?.usage;

    return {
      data: text,
      provider: "minimax",
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
    // AbortSignal.timeout() (router-supplied, D4.3-A) rejects as "TimeoutError";
    // a manually-aborted local AbortController rejects as "AbortError" — both
    // mean the same thing here: the request didn't finish in time.
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      throw new Error("MiniMax request timed out.");
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
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
    throw new Error("MiniMax provider returned unparseable JSON.");
  }

  return {
    ...textRes,
    data: parsed,
  };
}
