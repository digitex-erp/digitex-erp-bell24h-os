/**
 * Pure helpers for the admin Communications UI. No React, no network — so the rules that decide what
 * the operator may click are unit-tested (src/lib/__tests__/communicationsFlow.test.ts) and cannot drift
 * from what the server enforces (server/communication/CampaignService.ts).
 *
 * The server is the authority: these helpers only decide what to ENABLE and WHY something is disabled.
 * Every action is re-validated server-side.
 */

import type { CampaignStatus, CommCampaignDetail, CommChannel } from "@/types/communications";

export type StepState = "done" | "current" | "blocked" | "todo";

export interface FlowStep {
  key: "select" | "create" | "test" | "schedule" | "execute";
  label: string;
  state: StepState;
  note?: string;
}

export interface AvailableActions {
  canTest: boolean;
  canSchedule: boolean;
  canExecute: boolean;
  canCancel: boolean;
  /** Human-readable reason an action is unavailable (shown next to the disabled button). */
  reasons: { schedule?: string; execute?: string; test?: string };
}

const TESTABLE: CampaignStatus[] = ["draft", "scheduled", "paused"];
const SCHEDULABLE: CampaignStatus[] = ["draft", "scheduled"];
const EXECUTABLE: CampaignStatus[] = ["draft", "scheduled", "paused"];
const CANCELLABLE: CampaignStatus[] = ["draft", "scheduled", "running", "paused"];

export function availableActions(d: CommCampaignDetail): AvailableActions {
  const s = d.campaign.status;
  const reasons: AvailableActions["reasons"] = {};

  const gate = (): string | undefined => {
    if (!d.campaign.consent_confirmed_at) return "Recipient consent has not been confirmed.";
    if (d.campaign.total_recipients < 1) return "The campaign has no recipients.";
    if (!d.testVerified) {
      return d.lastTest
        ? `The last test message is "${d.lastTest.status}", not sent. Fix the provider and send another test.`
        : "Send a test message first and wait until it is sent.";
    }
    return undefined;
  };

  const testReason = TESTABLE.includes(s) ? undefined : `A test cannot be sent while the campaign is ${s}.`;
  if (testReason) reasons.test = testReason;

  const schedStatus = SCHEDULABLE.includes(s) ? undefined : `A ${s} campaign cannot be scheduled.`;
  const execStatus = EXECUTABLE.includes(s) ? undefined : `A ${s} campaign cannot be executed.`;
  const g = gate();
  if (schedStatus ?? g) reasons.schedule = schedStatus ?? g;
  if (execStatus ?? g) reasons.execute = execStatus ?? g;

  return {
    canTest: TESTABLE.includes(s),
    canSchedule: !reasons.schedule,
    canExecute: !reasons.execute,
    canCancel: CANCELLABLE.includes(s),
    reasons,
  };
}

/** The five-step flow: Select leads -> Create campaign -> Send test -> Schedule -> Execute. */
export function flowSteps(d: CommCampaignDetail): FlowStep[] {
  const s = d.campaign.status;
  const started = ["running", "paused", "completed", "failed"].includes(s);
  const closed = ["completed", "failed", "cancelled"].includes(s);

  const test: FlowStep = d.testVerified
    ? { key: "test", label: "Send test", state: "done", note: `Test to ${d.lastTest?.recipient} was sent.` }
    : d.lastTest
      ? { key: "test", label: "Send test", state: "blocked", note: `Last test is "${d.lastTest.status}".` }
      : { key: "test", label: "Send test", state: closed ? "todo" : "current" };

  const schedule: FlowStep = { key: "schedule", label: "Schedule", state: "todo" };
  if (s === "scheduled") {
    schedule.state = "done";
    schedule.note = d.campaign.scheduled_at ? `Scheduled for ${new Date(d.campaign.scheduled_at).toLocaleString()}.` : undefined;
  } else if (started) {
    schedule.state = "done";
    schedule.note = "Skipped or already run.";
  } else if (d.testVerified && !closed) {
    schedule.state = "current";
  }

  const execute: FlowStep = { key: "execute", label: "Execute", state: "todo" };
  if (s === "completed") execute.state = "done";
  else if (s === "failed") execute.state = "blocked";
  else if (s === "running") execute.state = "current";
  else if (s === "paused") {
    execute.state = "blocked";
    execute.note = d.campaign.paused_reason === "quota" ? "Paused: the organization's daily quota was reached. Execute again to resume." : "Paused.";
  } else if (d.testVerified && !closed) execute.state = "current";

  return [
    { key: "select", label: "Select leads", state: "done" },
    { key: "create", label: "Create campaign", state: "done" },
    test,
    schedule,
    execute,
  ];
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function statusTone(status: string): Tone {
  switch (status) {
    case "completed":
    case "sent":
    case "delivered":
    case "healthy":
      return "success";
    case "running":
    case "queued":
    case "scheduled":
    case "sending":
      return "info";
    case "paused":
    case "pending":
    case "unknown":
      return "warning";
    case "failed":
    case "dead_letter":
    case "down":
      return "danger";
    default:
      return "neutral";
  }
}

/** `<input type="datetime-local">` value (local time, no zone) -> ISO-8601 UTC, or null when invalid. */
export function localDateTimeToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Earliest selectable schedule time as a datetime-local string: now + 2 minutes (the server requires >= 1). */
export function minScheduleLocal(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 2 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Share of recipients that reached a final state, for the progress bar. */
export function progressPercent(counts: Partial<Record<string, number>>, total: number): number {
  if (total <= 0) return 0;
  const done = (counts.sent ?? 0) + (counts.failed ?? 0) + (counts.cancelled ?? 0);
  return Math.min(100, Math.round((done / total) * 100));
}

export function leadName(l: { first_name: string | null; last_name: string | null; email: string | null; phone: string | null }): string {
  return [l.first_name, l.last_name].filter(Boolean).join(" ") || l.email || l.phone || "(unnamed)";
}

export function addressFor(channel: CommChannel, l: { email: string | null; phone: string | null }): string {
  return (channel === "email" ? l.email : l.phone) ?? "";
}

/** Poll while something is in flight; stop when the campaign is at rest. */
export function shouldPoll(d: CommCampaignDetail | null): boolean {
  if (!d) return false;
  if (["running", "scheduled"].includes(d.campaign.status)) return true;
  return d.lastTest !== null && ["queued", "scheduled", "sending", "failed"].includes(d.lastTest.status) && !d.testVerified;
}

export interface HealthNote {
  tone: "warning" | "danger";
  text: string;
}

/**
 * What the dashboard may honestly say about the send pipeline. Only warnings derived from real counts:
 * it never reports "healthy" — the absence of a warning is not evidence that anything works.
 */
export function pipelineWarnings(
  providers: { total: number; canSend: number; credentialsConfigured: number; verified: number },
  worker: { queuedJobs: number; oldestQueuedAt: string | null; deadLetterJobs: number; lastJobCompletedAt: string | null },
  now: Date = new Date(),
): HealthNote[] {
  const notes: HealthNote[] = [];
  if (providers.total === 0) {
    notes.push({ tone: "danger", text: "No provider is configured for this organization. Every send will fail with PROVIDER_NOT_CONFIGURED." });
  } else if (providers.credentialsConfigured === 0) {
    notes.push({ tone: "danger", text: "Providers exist but none has its credential set on the server. Every send will fail." });
  } else if (providers.verified === 0) {
    notes.push({ tone: "warning", text: "No provider has ever completed a real send. Configured is not verified: send a test message to verify." });
  }
  if (worker.queuedJobs > 0 && worker.oldestQueuedAt) {
    const ageMin = Math.floor((now.getTime() - new Date(worker.oldestQueuedAt).getTime()) / 60_000);
    if (ageMin >= 5) {
      notes.push({
        tone: worker.lastJobCompletedAt ? "warning" : "danger",
        text: `${worker.queuedJobs} job(s) are waiting; the oldest has been due for ${ageMin} minute(s). The worker trigger may not be running.`,
      });
    }
  }
  if (worker.queuedJobs > 0 && !worker.lastJobCompletedAt) {
    notes.push({ tone: "warning", text: "No communication job has ever completed, so there is no evidence the worker trigger is running." });
  }
  if (worker.deadLetterJobs > 0) {
    notes.push({ tone: "danger", text: `${worker.deadLetterJobs} job(s) exhausted their retries (dead-lettered). Check the Logs tab for the errors.` });
  }
  return notes;
}
