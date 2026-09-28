import { AuthedFetchError, authedFetchJson } from "@/lib/authedFetch";
import type {
  CommAttempt,
  CommAudienceSummary,
  CommCampaign,
  CommCampaignDetail,
  CommChannel,
  CommDashboard,
  CommHealthResult,
  CommLead,
  CommLogRow,
  CommProvider,
  CommRecipient,
  CommSchedule,
  CommTemplate,
  CommWorkerEvidence,
} from "@/types/communications";

/**
 * Typed client for /api/communications/*. Every call goes through authedFetchJson, i.e. it carries the
 * caller's own Supabase session token; the server derives the organization and role from it. Nothing
 * here fabricates a result: a failed request throws AuthedFetchError and the UI shows it.
 */

const BASE = "/api/communications";

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
  authedFetchJson<T>(`${BASE}${path}`, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body), headers });

/** A fresh key per user action (one click = one key), so a double click or retry is deduplicated by the server. */
export const newIdempotencyKey = () => `ui-${crypto.randomUUID()}`;

export const communicationsApi = {
  getDashboard: () => authedFetchJson<CommDashboard>(`${BASE}/dashboard`),
  listSchedules: () => authedFetchJson<{ schedules: CommSchedule[]; worker: CommWorkerEvidence }>(`${BASE}/schedules`),
  listTemplates: (channelType?: CommChannel) => authedFetchJson<{ templates: CommTemplate[] }>(`${BASE}/templates${qs({ channelType })}`),
  createTemplate: (b: { name: string; channelType: CommChannel; subject?: string; body: string }) =>
    post<{ success: true; template: CommTemplate }>("/templates", b),

  listLeads: (p: { channelType: CommChannel; q?: string; limit?: number; offset?: number }) =>
    authedFetchJson<{ leads: CommLead[]; limit: number; offset: number }>(`${BASE}/leads${qs(p)}`),

  createCampaign: (b: { name: string; channelType: CommChannel; templateId: string; contactIds: string[]; consentConfirmed: boolean }) =>
    post<{ success: true; campaign: CommCampaign; audience: CommAudienceSummary }>("/campaigns", b),
  listCampaigns: (status?: string) => authedFetchJson<{ campaigns: CommCampaign[] }>(`${BASE}/campaigns${qs({ status, limit: 100 })}`),
  getCampaign: (id: string) => authedFetchJson<CommCampaignDetail>(`${BASE}/campaigns/${id}`),
  listRecipients: (id: string, p: { status?: string; limit?: number; offset?: number } = {}) =>
    authedFetchJson<{ recipients: CommRecipient[] }>(`${BASE}/campaigns/${id}/recipients${qs(p)}`),
  sendTest: (id: string, testRecipient: string, idempotencyKey: string) =>
    post<{ success: true; deduplicated: boolean }>(`/campaigns/${id}/test`, { testRecipient }, { "Idempotency-Key": idempotencyKey }),
  schedule: (id: string, scheduledAt: string) => post<{ campaign: CommCampaign }>(`/campaigns/${id}/schedule`, { scheduledAt }),
  execute: (id: string) => post<{ campaign: CommCampaign }>(`/campaigns/${id}/execute`),
  cancel: (id: string) => post<{ campaign: CommCampaign }>(`/campaigns/${id}/cancel`),

  listLogs: (p: { campaignId?: string; status?: string; channelType?: string; includeTests?: boolean; limit?: number; offset?: number }) =>
    authedFetchJson<{ logs: CommLogRow[]; limit: number; offset: number }>(`${BASE}/logs${qs(p)}`),
  getAttempts: (messageId: string) => authedFetchJson<{ attempts: CommAttempt[] }>(`${BASE}/logs/${messageId}/attempts`),

  listProviders: () => authedFetchJson<{ providers: CommProvider[] }>(`${BASE}/providers`),
  healthCheck: (id: string) => post<CommHealthResult>(`/providers/${id}/health-check`),
};

/** Turns any thrown value into text an operator can act on. */
export function errorText(err: unknown): string {
  if (err instanceof AuthedFetchError) {
    if (err.status === 401) return "You are not signed in. Sign in again.";
    if (err.status === 403) return "Your role does not allow this action (or you have no role in this organization).";
    if (err.status === 429) return `${err.message} — please wait and try again.`;
    return err.message;
  }
  return err instanceof Error ? err.message : "Unexpected error.";
}
