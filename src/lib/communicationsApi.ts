import { AuthedFetchError, authedFetchJson } from "@/lib/authedFetch";
import type {
  CommAttempt,
  CommAudienceSummary,
  CommCampaign,
  CommCampaignAnalytics,
  CommCampaignDetail,
  CommChannel,
  CommDashboard,
  CommHealthResult,
  CommLead,
  CommList,
  CommListMember,
  CommLogRow,
  CommOrgAnalytics,
  CommProvider,
  CommRecipient,
  CommSchedule,
  CommSegment,
  CommSegmentPreview,
  CommSuppression,
  CommTemplate,
  CommWorkerEvidence,
  SegmentCriteria,
  SuppressionReason,
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

const send = <T>(method: "PATCH" | "DELETE", path: string, body?: unknown) =>
  authedFetchJson<T>(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

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

  updateTemplate: (id: string, b: { name?: string; subject?: string; body?: string; isActive?: boolean }) =>
    send<{ success: true; template: CommTemplate }>("PATCH", `/templates/${id}`, b),

  /** Exactly ONE of contactIds / listId / segmentId. */
  createCampaign: (
    b: { name: string; channelType: CommChannel; templateId: string; consentConfirmed: boolean } & ({ contactIds: string[] } | { listId: string } | { segmentId: string }),
  ) => post<{ success: true; campaign: CommCampaign; audience: CommAudienceSummary }>("/campaigns", b),
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

  listSuppressions: (p: { channelType?: CommChannel; reason?: SuppressionReason; q?: string; limit?: number; offset?: number }) =>
    authedFetchJson<{ suppressions: CommSuppression[]; total: number; limit: number; offset: number }>(`${BASE}/suppressions${qs(p)}`),
  addSuppressions: (b: { channelType: CommChannel; addresses: string[]; reason: SuppressionReason; note?: string }) =>
    post<{ success: true; added: number; alreadySuppressed: number; invalid: string[] }>("/suppressions", b),
  removeSuppression: (id: string) => send<{ success: true }>("DELETE", `/suppressions/${id}`),

  listLists: () => authedFetchJson<{ lists: CommList[] }>(`${BASE}/lists`),
  createList: (b: { name: string; description?: string }) => post<{ success: true; list: CommList }>("/lists", b),
  deleteList: (id: string) => send<{ success: true }>("DELETE", `/lists/${id}`),
  listMembers: (id: string, p: { limit?: number; offset?: number } = {}) =>
    authedFetchJson<{ members: CommListMember[]; limit: number; offset: number }>(`${BASE}/lists/${id}/members${qs(p)}`),
  addMembers: (id: string, contactIds: string[]) =>
    post<{ success: true; added: number; alreadyMembers: number; notFound: number }>(`/lists/${id}/members`, { contactIds }),
  removeMembers: (id: string, contactIds: string[]) => send<{ success: true; removed: number }>("DELETE", `/lists/${id}/members`, { contactIds }),

  listSegments: () => authedFetchJson<{ segments: CommSegment[] }>(`${BASE}/segments`),
  createSegment: (b: { name: string; criteria: SegmentCriteria }) => post<{ success: true; segment: CommSegment }>("/segments", b),
  deleteSegment: (id: string) => send<{ success: true }>("DELETE", `/segments/${id}`),
  previewSegment: (b: { channelType: CommChannel; criteria: SegmentCriteria }) => post<CommSegmentPreview>("/segments/preview", b),

  getAnalytics: (days: number) => authedFetchJson<CommOrgAnalytics>(`${BASE}/analytics${qs({ days })}`),
  getCampaignAnalytics: (id: string) => authedFetchJson<CommCampaignAnalytics>(`${BASE}/campaigns/${id}/analytics`),

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
