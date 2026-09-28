/**
 * Pure helpers for the Industry Intelligence page (no React, no network) so the form rules are unit-tested and
 * cannot drift from what the server enforces (server/industry/IndustryService.ts). The server remains the authority.
 */

import type { NewSignal, SignalType, SourceType, TrendDirection } from "@/types/industry";

export const SIGNAL_TYPES: { value: SignalType; label: string }[] = [
  { value: "demand", label: "Demand" },
  { value: "supply", label: "Supply" },
  { value: "price", label: "Price" },
  { value: "regulation", label: "Regulation" },
  { value: "trend", label: "Trend" },
  { value: "other", label: "Other" },
];

export const SOURCE_TYPES: { value: SourceType; label: string; help: string }[] = [
  { value: "user_provided", label: "Entered by a person", help: "Something you know or were told. No URL needed." },
  { value: "public_api", label: "Public API", help: "Data you looked up from a public API. A source URL is required." },
  { value: "web_search", label: "Web search", help: "Something you found through a web search. A source URL is required." },
];

/** The reason the form cannot be submitted, or null. Mirrors validateSignal on the server. */
export function signalFormProblem(f: Partial<NewSignal> & { sourceUrl?: string }): string | null {
  if (!f.title || f.title.trim() === "") return "Enter a title.";
  if (f.title.trim().length > 200) return "The title is at most 200 characters.";
  if ((f.summary ?? "").length > 2000) return "The summary is at most 2000 characters.";
  if (!f.signalType) return "Choose a signal type.";
  if (!f.sourceType) return "Choose where the signal came from.";
  const url = (f.sourceUrl ?? "").trim();
  if (f.sourceType !== "user_provided" && url === "") return "A source URL is required so the signal can be checked.";
  if (url !== "") {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "The source URL must start with http:// or https://.";
      if (u.username || u.password) return "The source URL must not contain credentials.";
    } catch {
      return "The source URL is not a valid URL.";
    }
  }
  if (f.observedAt && new Date(f.observedAt).getTime() > Date.now() + 24 * 3600_000) return "The observation date cannot be in the future.";
  if ((f.opportunityNote ?? "").trim() !== "" && !f.isRfqOpportunity) return "A note is only kept for signals flagged as an RFQ opportunity.";
  if ((f.opportunityNote ?? "").length > 500) return "The opportunity note is at most 500 characters.";
  return null;
}

export function directionLabel(d: TrendDirection): { text: string; tone: "info" | "warning" | "neutral" | "success" } {
  switch (d) {
    case "rising":
      return { text: "more signals recently", tone: "success" };
    case "falling":
      return { text: "fewer signals recently", tone: "warning" };
    case "flat":
      return { text: "steady", tone: "info" };
    default:
      return { text: "not enough data", tone: "neutral" };
  }
}

export function sourceLabel(t: SourceType): string {
  return SOURCE_TYPES.find((s) => s.value === t)?.label ?? t;
}

/** Height (0-100) of a weekly bar relative to the largest week shown; an empty series is all zeros, never NaN. */
export function barHeights(counts: number[]): number[] {
  const max = Math.max(0, ...counts);
  return counts.map((c) => (max === 0 ? 0 : Math.round((c / max) * 100)));
}
