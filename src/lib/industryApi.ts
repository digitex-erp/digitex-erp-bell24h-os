import { authedFetchJson } from "@/lib/authedFetch";
import type { IndustryCategory, IndustryRow, IndustrySignal, IndustrySummary, IndustryTrend, NewSignal, SignalType, SourceType } from "@/types/industry";

/**
 * Typed client for /api/industry/*. Every call carries the caller's own session token; the server derives the
 * organization and role from it. Nothing here fabricates data: a failure throws and the page shows it.
 */
const BASE = "/api/industry";

const qs = (p: Record<string, string | number | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : "";
};
const send = <T>(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) =>
  authedFetchJson<T>(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const industryApi = {
  overview: () => authedFetchJson<{ industries: IndustryRow[]; summary: IndustrySummary }>(`${BASE}/overview`),
  createIndustry: (b: { name: string; description?: string }) => send<{ success: true; industry: IndustryRow }>("POST", "/industries", b),
  deleteIndustry: (id: string) => send<{ success: true }>("DELETE", `/industries/${id}`),
  listCategories: (industryId: string) => authedFetchJson<{ categories: IndustryCategory[] }>(`${BASE}/industries/${industryId}/categories`),
  createCategory: (industryId: string, b: { name: string; description?: string }) => send<{ success: true; category: IndustryCategory }>("POST", `/industries/${industryId}/categories`, b),
  listSignals: (p: { industryId?: string; signalType?: SignalType; sourceType?: SourceType; limit?: number; offset?: number } = {}) =>
    authedFetchJson<{ signals: IndustrySignal[]; total: number; limit: number; offset: number }>(`${BASE}/signals${qs(p)}`),
  listOpportunities: () => authedFetchJson<{ signals: IndustrySignal[]; total: number }>(`${BASE}/opportunities${qs({ limit: 50 })}`),
  createSignal: (b: NewSignal) => send<{ success: true; signal: IndustrySignal }>("POST", "/signals", b),
  setOpportunity: (id: string, b: { isRfqOpportunity: boolean; opportunityNote?: string }) => send<{ success: true; signal: IndustrySignal }>("PATCH", `/signals/${id}`, b),
  deleteSignal: (id: string) => send<{ success: true }>("DELETE", `/signals/${id}`),
  trends: (weeks = 8) => authedFetchJson<{ weeks: number; trends: IndustryTrend[]; note: string }>(`${BASE}/trends${qs({ weeks })}`),
};

/** True when the server reported that the industry tables have never been created (a set-up gap, not an empty org). */
export const isTablesMissing = (message: string) => message.includes("industry_tables_missing");
