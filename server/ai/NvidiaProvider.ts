/**
 * Server-side NVIDIA NIM adapter.
 *
 * OS-INTEGRATION-IMPLEMENTATION-04D: uses NVIDIA's OpenAI-compatible chat completions
 * endpoint (https://integrate.api.nvidia.com/v1). Credentials come from
 * ProviderManager (process environment only) — this module must never be imported from
 * `src/` (client code), matching GeminiProvider.ts's own convention.
 *
 * The request/response shape mirrors the existing, already-proven client-side
 * OpenCompatibleProvider (src/modules/ai-providers/AiProviderService.ts) — used here as
 * a REFERENCE for the wire format only. No browser-specific credential handling was
 * carried over: that class receives its (always-undefined, per BR-01/04C-1) api_key as
 * a constructor argument; this module resolves its own credential directly via
 * ProviderManager.getCredential(), the same fail-closed pattern GeminiProvider.ts uses.
 *
 * Reuses GeminiProvider.ts's existing TextRequest/ProviderResult types rather than
 * defining a duplicate provider interface — there is no shared provider contract file
 * in this repository yet, and creating one for a single additional provider would be
 * more abstraction than this sprint's scope calls for.
 */

import { getCredential } from "./ProviderManager.js";
import type { TextRequest, ProviderResult } from "./GeminiProvider.js";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/**
 * No NVIDIA model was ever chosen anywhere in this repository before this sprint
 * (confirmed in OS-INTEGRATION-IMPLEMENTATION-04C — the client-side reference reads an
 * unset `default_model` column instead of hardcoding one). This value is a new design
 * decision made in this sprint for adapter completeness, matching GeminiProvider.ts's
 * own DEFAULT_MODEL pattern — not sourced from any existing config. Reconsider before
 * real production use if a different NVIDIA NIM catalog model is preferred.
 */
export const DEFAULT_MODEL = "meta/llama-3.1-8b-instruct";

const REQUEST_TIMEOUT_MS = 30_000;

/** Plain text completion via NVIDIA's OpenAI-compatible endpoint. */
export async function generateText(req: TextRequest): Promise<ProviderResult<string>> {
  const { apiKey } = getCredential("nvidia");
  const model = req.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Never logged, never included in a thrown error — the credential exists only
        // in this header value for the duration of this one request.
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: req.prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err: any) {
    // Deliberately generic messages — never interpolate the raw fetch error, which
    // could in principle echo request details, into anything credential-adjacent.
    if (err?.name === "AbortError") {
      throw new Error("NVIDIA request timed out.");
    }
    throw new Error("NVIDIA request failed.");
  } finally {
    clearTimeout(timeoutId);
  }

  const data: any = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" && data.error?.message) ||
      `NVIDIA API error (${response.status}).`;
    throw new Error(message);
  }

  const text = data?.choices?.[0]?.message?.content ?? "";
  return { data: text, model, latencyMs: Date.now() - startedAt };
}
