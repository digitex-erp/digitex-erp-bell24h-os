/**
 * Bell24h-OS Voice Studio — driver seam.
 *
 * Migrated from the Shogo prototype's src/lib/voice-driver.ts (read directly
 * from the source archive, since it was absent from the shogo-prototype git
 * branch — see docs/audits/SHOGO_VOICE_STUDIO_MIGRATION_REPORT.md). The
 * interface and both drivers are ported near-verbatim; only naming/comment
 * style was adjusted to this repo's convention. No Shogo auth, DB client, or
 * queue code is referenced here — this module is self-contained.
 *
 * A VoiceTask is handed to a *driver*, which is responsible for actually
 * running the call and returning a structured capture. Two drivers ship here:
 *
 *   simulated — deterministic, offline, honestly labelled. Lets the whole
 *               RFQ -> call -> capture -> writeback loop be exercised
 *               end-to-end without a carrier.
 *   dograh    — POSTs the task to a self-hosted Dograh voice server
 *               (github.com/dograh-hq/dograh) and expects the capture back
 *               on the webhook route. Requires DOGRAH_BASE_URL +
 *               DOGRAH_AGENT_ID; returns a hard error when unconfigured
 *               rather than pretending or silently falling back to simulation.
 */

export type VoiceCaptureOutcome = "captured" | "no_answer" | "declined" | "failed";

export interface VoiceCapture {
  outcome: VoiceCaptureOutcome;
  interested: boolean;
  price: number | null;
  currency: string;
  moq: string | null;
  deliveryDays: number | null;
  remarks: string | null;
  confidence: number;
}

export interface VoiceDispatchInput {
  ref: string;
  contactName: string;
  company: string | null;
  phone: string | null;
  objective: string;
  language: string;
  rfq: {
    id: string;
    title: string;
    quantity: string;
    unit: string | null;
    category: string | null;
    budget: number | null;
    currency: string;
    deadline: Date | null;
  } | null;
}

export interface VoiceDispatchResult {
  driverJobId: string;
  /** Live drivers return immediately with a job id; the capture arrives later. */
  accepted: boolean;
  /** Only the simulated driver returns a capture inline. */
  capture: VoiceCapture | null;
  transcript: { speaker: string; text: string; atSec: number }[];
  error?: string;
}

export interface VoiceDriver {
  name: string;
  simulated: boolean;
  dispatch(input: VoiceDispatchInput): Promise<VoiceDispatchResult>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Stable FNV-1a hash so the simulated driver is deterministic per task. */
function seedFrom(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Last-4-digits-only display form. Never log or store the full number. */
export function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••••${digits.slice(-4)}`;
}

// ─── simulated driver ───────────────────────────────────────────────────────

function buildSimulatedCapture(input: VoiceDispatchInput): {
  capture: VoiceCapture;
  transcript: { speaker: string; text: string; atSec: number }[];
} {
  const seed = seedFrom(input.ref);
  const roll = seed % 100;
  const agent = "AI agent";
  const supplier = input.contactName || "Supplier";

  const qty = input.rfq ? `${input.rfq.quantity}${input.rfq.unit ? " " + input.rfq.unit : ""}` : "the requirement";
  const item = input.rfq?.title ?? "the RFQ";
  const budget = input.rfq?.budget ?? null;
  const currency = input.rfq?.currency ?? "INR";

  const transcript: { speaker: string; text: string; atSec: number }[] = [
    {
      speaker: agent,
      text: `Hello, this is the Bell24h-OS supplier assistant calling about ${item}. Is this a good time?`,
      atSec: 0,
    },
  ];

  if (roll < 12) {
    transcript.push({ speaker: supplier, text: "We are not able to take this on right now.", atSec: 8 });
    return {
      capture: {
        outcome: "declined",
        interested: false,
        price: null,
        currency,
        moq: null,
        deliveryDays: null,
        remarks: "Supplier declined — no capacity for this requirement.",
        confidence: 0.88,
      },
      transcript,
    };
  }

  if (roll < 22) {
    transcript.push({ speaker: agent, text: "I will try again later. Thank you.", atSec: 6 });
    return {
      capture: {
        outcome: "no_answer",
        interested: false,
        price: null,
        currency,
        moq: null,
        deliveryDays: null,
        remarks: "No answer after 30 seconds — scheduled for retry.",
        confidence: 0.4,
      },
      transcript,
    };
  }

  const deliveryDays = 12 + (seed % 14);
  const price = budget && budget > 0 ? Math.round((budget / 100) * (94 + (seed % 13))) : 200 + (seed % 180);
  const moq = `${1 + (seed % 5) * 25} ${input.rfq?.unit ?? "units"}`;

  transcript.push(
    { speaker: supplier, text: "Yes, go ahead.", atSec: 9 },
    { speaker: agent, text: `Can you supply ${qty}?`, atSec: 13 },
    { speaker: supplier, text: `We can do it in ${deliveryDays} days.`, atSec: 19 },
    { speaker: agent, text: "What would be your price per unit?", atSec: 23 },
    { speaker: supplier, text: `${currency} ${price} per unit, minimum order ${moq}.`, atSec: 30 },
    {
      speaker: agent,
      text: `Thank you. I have recorded ${currency} ${price} per unit, ${deliveryDays} days delivery and a minimum order of ${moq}.`,
      atSec: 36,
    },
  );

  return {
    capture: {
      outcome: "captured",
      interested: true,
      price,
      currency,
      moq,
      deliveryDays,
      remarks: `Capacity confirmed for ${qty}.`,
      confidence: 0.88 + (seed % 11) / 100,
    },
    transcript,
  };
}

export const simulatedDriver: VoiceDriver = {
  name: "simulated",
  simulated: true,
  async dispatch(input) {
    const { capture, transcript } = buildSimulatedCapture(input);
    return {
      driverJobId: `sim-${input.ref}`,
      accepted: true,
      capture,
      transcript,
    };
  },
};

// ─── dograh driver (self-hosted voice server) ───────────────────────────────
//
// Dograh exposes a *per-agent* API Trigger endpoint, so there is no generic
// "create call" API to post to:
//
//   POST {DOGRAH_BASE_URL}/api/v1/public/agent/{uuid}        published workflow
//   POST {DOGRAH_BASE_URL}/api/v1/public/agent/test/{uuid}   latest draft
//   header: X-API-Key: {DOGRAH_API_KEY}
//   body:   { phone_number, initial_context }
//   reply:  { workflow_run_id }
//
// The extraction result comes back later from the workflow's Webhook node,
// which posts gathered_context to POST /api/voice/webhooks/dograh.
// Docs: https://docs.dograh.com/voice-agent/api-trigger

/** Variables handed to the agent as `initial_context`. */
export function dograhInitialContext(input: VoiceDispatchInput) {
  const quantity = input.rfq ? `${input.rfq.quantity}${input.rfq.unit ? " " + input.rfq.unit : ""}` : "";

  return {
    task_ref: input.ref,
    contact_name: input.contactName,
    company: input.company ?? "",
    objective: input.objective,
    language: input.language,
    rfq_id: input.rfq?.id ?? "",
    rfq_title: input.rfq?.title ?? "",
    rfq_quantity: quantity,
    rfq_category: input.rfq?.category ?? "",
    rfq_budget: input.rfq?.budget != null ? String(input.rfq.budget) : "",
    rfq_currency: input.rfq?.currency ?? "INR",
    rfq_deadline: input.rfq?.deadline ? input.rfq.deadline.toISOString().slice(0, 10) : "",
  };
}

export function dograhLaunchPayload(input: VoiceDispatchInput) {
  return {
    phone_number: input.phone ?? "",
    initial_context: dograhInitialContext(input),
  };
}

/** Trigger URL. `mode` defaults to DOGRAH_AGENT_MODE; "test" uses the draft. */
export function dograhTriggerUrl(baseUrl: string, agentId: string, mode?: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const draft = (mode ?? process.env.DOGRAH_AGENT_MODE) === "test";
  return `${base}/api/v1/public/agent/${draft ? "test/" : ""}${agentId}`;
}

/** Dograh's documented HTTP error codes, turned into something actionable. */
export function dograhErrorHint(status: number): string {
  switch (status) {
    case 400:
      return "Dograh could not place the call — most often no telephony provider is configured for the organization.";
    case 401:
      return "Missing or invalid API key. Set DOGRAH_API_KEY to a key from the Dograh developer portal.";
    case 403:
      return "This API key does not have access to that agent.";
    case 404:
      return "Trigger not found or not active. Check DOGRAH_AGENT_ID, and publish the workflow if you are using the production URL.";
    default:
      return "Unexpected response from Dograh.";
  }
}

export const dograhDriver: VoiceDriver = {
  name: "dograh",
  simulated: false,
  async dispatch(input) {
    const baseUrl = process.env.DOGRAH_BASE_URL;
    const agentId = process.env.DOGRAH_AGENT_ID;

    const missing = [!baseUrl && "DOGRAH_BASE_URL", !agentId && "DOGRAH_AGENT_ID"].filter(Boolean) as string[];

    if (missing.length) {
      return {
        driverJobId: "",
        accepted: false,
        capture: null,
        transcript: [],
        error: `${missing.join(" and ")} not configured. Point ${
          missing.length > 1 ? "them" : "it"
        } at a running Dograh instance and its API Trigger agent id, or dispatch with driver="simulated". See GET /api/voice/dograh/contract.`,
      };
    }

    if (!input.phone) {
      return {
        driverJobId: "",
        accepted: false,
        capture: null,
        transcript: [],
        error: "This task has no phone number. Dograh requires phone_number to place an outbound call.",
      };
    }

    const url = dograhTriggerUrl(baseUrl!, agentId!);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.DOGRAH_API_KEY ? { "X-API-Key": process.env.DOGRAH_API_KEY } : {}),
        },
        body: JSON.stringify(dograhLaunchPayload(input)),
        signal: AbortSignal.timeout(15000),
      });

      const body: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        const detail = body?.detail ?? body?.error ?? body?.message;
        return {
          driverJobId: "",
          accepted: false,
          capture: null,
          transcript: [],
          error: `Dograh rejected the call (HTTP ${res.status}). ${dograhErrorHint(res.status)}${
            detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""
          }`,
        };
      }

      const runId = body?.workflow_run_id ?? body?.id;
      if (runId === undefined || runId === null) {
        return {
          driverJobId: "",
          accepted: false,
          capture: null,
          transcript: [],
          error: `Dograh accepted the request but returned no workflow_run_id (got ${JSON.stringify(body).slice(
            0,
            200,
          )}). The capture could not be matched back to this task.`,
        };
      }

      return { driverJobId: String(runId), accepted: true, capture: null, transcript: [] };
    } catch (err: any) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      return {
        driverJobId: "",
        accepted: false,
        capture: null,
        transcript: [],
        error: timedOut
          ? `Dograh did not respond within 15s at ${url}.`
          : `Dograh unreachable at ${url}: ${err?.message ?? "request failed"}`,
      };
    }
  },
};

export function getDriver(name: string | null | undefined): VoiceDriver {
  return name === "dograh" ? dograhDriver : simulatedDriver;
}

// ─── Dograh native payload -> VoiceCapture ──────────────────────────────────

export function isDograhPayload(body: any): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      (body.gathered_context || body.workflow_run_id !== undefined || body.initial_context),
  );
}

const DOGRAH_DISPOSITIONS: Record<string, VoiceCaptureOutcome> = {
  completed: "captured",
  answered: "captured",
  interested: "captured",
  qualified: "captured",
  quote_captured: "captured",
  quoted: "captured",

  no_answer: "no_answer",
  noanswer: "no_answer",
  busy: "no_answer",
  voicemail: "no_answer",
  unanswered: "no_answer",

  declined: "declined",
  declined_quote: "declined",
  not_interested: "declined",
  rejected: "declined",

  failed: "failed",
  error: "failed",
  canceled: "failed",
  cancelled: "failed",
};

export function mapDograhOutcome(raw: unknown): VoiceCaptureOutcome | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return DOGRAH_DISPOSITIONS[key] ?? DOGRAH_DISPOSITIONS[key.replace(/-/g, "_")] ?? null;
}

/** "₹1,240 per unit" -> 1240. Extracted values are LLM output, so be tolerant. */
export function coerceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.replace(/,(?=\d{3}\b)/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

const TRUE_WORDS = ["true", "yes", "y", "1", "interested", "haan", "ha", "ok"];
const FALSE_WORDS = ["false", "no", "n", "0", "not interested", "nahi", "uninterested"];

export function coerceBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();
  if (TRUE_WORDS.includes(s)) return true;
  if (FALSE_WORDS.includes(s)) return false;
  return null;
}

function pickFrom(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

export interface DograhCaptureResult {
  taskRef: string | null;
  driverJobId: string | null;
  capture: VoiceCapture;
  durationSec: number;
  recordingUrl: string | null;
  transcriptUrl: string | null;
  costUsd: number;
}

export function fromDograhPayload(body: any): DograhCaptureResult {
  const gathered = body?.gathered_context ?? {};
  const initial = body?.initial_context ?? {};
  const cost = body?.cost_info ?? {};

  const disposition = pickFrom(gathered, ["mapped_call_disposition", "call_disposition"]) ?? gathered?.call_status;
  const outcome = mapDograhOutcome(disposition) ?? mapDograhOutcome(gathered?.call_status) ?? "failed";

  const price = coerceNumber(pickFrom(gathered, ["price", "quote_price", "quoted_price", "unit_price", "rate", "amount"]));
  const moqRaw = pickFrom(gathered, ["moq", "minimum_order", "min_order_quantity"]);
  const deliveryDays = coerceNumber(pickFrom(gathered, ["delivery_days", "delivery_time_days", "lead_time_days"]));
  const remarksRaw = pickFrom(gathered, ["remarks", "summary", "notes", "comment", "call_summary"]);
  const confidenceRaw = coerceNumber(pickFrom(gathered, ["confidence", "extraction_confidence"]));
  const currencyRaw = pickFrom(gathered, ["currency"]);

  const statedInterested = coerceBool(pickFrom(gathered, ["interested", "is_interested", "supplier_interested"]));
  const hasQuote = price !== null || moqRaw !== undefined || deliveryDays !== null;

  // A "completed" call with nothing extracted must not silently flip the RFQ
  // to quoted, so interest is only assumed when there is something behind it.
  const interested = outcome === "captured" ? statedInterested ?? hasQuote : false;

  return {
    taskRef: (initial?.task_ref as string) ?? (body?.taskRef as string) ?? null,
    driverJobId: body?.workflow_run_id != null ? String(body.workflow_run_id) : null,
    capture: {
      outcome,
      interested,
      price,
      currency: typeof currencyRaw === "string" && currencyRaw ? currencyRaw : "INR",
      moq: moqRaw === undefined ? null : String(moqRaw),
      deliveryDays,
      remarks: remarksRaw === undefined ? null : String(remarksRaw),
      confidence: Math.max(0, Math.min(1, confidenceRaw ?? (outcome === "captured" ? 0.8 : 0.5))),
    },
    durationSec: Math.max(0, Math.round(coerceNumber(cost?.call_duration_seconds) ?? 0)),
    recordingUrl: typeof body?.recording_url === "string" ? body.recording_url : null,
    transcriptUrl: typeof body?.transcript_url === "string" ? body.transcript_url : null,
    costUsd: Math.max(0, coerceNumber(pickFrom(cost, ["total_cost", "cost_usd", "amount", "total"])) ?? 0),
  };
}

// ─── the contract the real voice server must implement ──────────────────────

export function dograhCaptureContract() {
  return {
    version: "1.1",
    driver: "dograh",
    docs: "https://docs.dograh.com/voice-agent/api-trigger",
    launch: {
      direction: "Bell24h-OS -> Dograh",
      method: "POST",
      url: "{DOGRAH_BASE_URL}/api/v1/public/agent/{DOGRAH_AGENT_ID}",
      urlDraft: "{DOGRAH_BASE_URL}/api/v1/public/agent/test/{DOGRAH_AGENT_ID}",
      headers: { "Content-Type": "application/json", "X-API-Key": "{DOGRAH_API_KEY}" },
      response: { workflow_run_id: 12345 },
    },
    callback: {
      direction: "Dograh -> Bell24h-OS (Webhook node)",
      method: "POST",
      url: "{BELL24H_ORIGIN}/api/voice/webhooks/dograh",
      auth: {
        type: "API_KEY",
        header: "x-bell24h-voice-webhook-secret",
        value: "{DOGRAH_WEBHOOK_SECRET}",
        note: "DOGRAH_WEBHOOK_SECRET is required. If unset, the webhook route fails closed (503) rather than accepting unverified calls — unlike the Shogo source, which allowed an unset-secret fallback.",
      },
      require2xx: "Dograh logs non-2xx and does not retry by default, so Bell24h-OS answers 2xx — or a 4xx that explains itself — within 30s.",
    },
    outcomeMapping: {
      captured: ["completed", "answered", "interested", "qualified", "quote_captured", "quoted"],
      no_answer: ["no-answer", "no_answer", "busy", "voicemail", "unanswered"],
      declined: ["declined", "declined_quote", "not_interested", "rejected"],
      failed: ["failed", "error", "canceled", "cancelled"],
    },
    ownership:
      "Bell24h-OS owns the writeback: it updates the call record and writes the CRM timeline entry (comm_events). The voice server must not write to those itself.",
    idempotency:
      "A repeat delivery of the same workflow_run_id for a call that already reached a terminal status is acknowledged without re-applying the writeback.",
  };
}
