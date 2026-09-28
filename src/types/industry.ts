/** Wire types for /api/industry/* (server: server/industry/routes.ts). */

export type SignalType = "demand" | "supply" | "price" | "regulation" | "trend" | "other";
export type SourceType = "user_provided" | "public_api" | "web_search";
export type TrendDirection = "rising" | "falling" | "flat" | "insufficient_data";

export interface IndustryRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  categories: number;
  buyer_personas: number;
  supplier_personas: number;
  signals: number;
  signals_30d: number;
}

export interface IndustrySummary {
  signals: number;
  signals_30d: number;
  opportunities: number;
  user_provided: number;
  public_api: number;
  web_search: number;
  unassigned: number;
}

export interface IndustryCategory {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface IndustrySignal {
  id: string;
  title: string;
  summary: string | null;
  signal_type: SignalType;
  source_type: SourceType;
  source_name: string | null;
  source_url: string | null;
  observed_at: string;
  is_rfq_opportunity: boolean;
  opportunity_note: string | null;
  industry_id: string | null;
  industry_name: string | null;
  created_at: string;
}

export interface IndustryTrend {
  industryId: string | null;
  name: string;
  weekly: { weekStart: string; count: number }[];
  total: number;
  direction: TrendDirection;
}

export interface NewSignal {
  title: string;
  summary?: string;
  signalType: SignalType;
  sourceType: SourceType;
  sourceName?: string;
  sourceUrl?: string;
  observedAt?: string;
  industryId?: string;
  isRfqOpportunity?: boolean;
  opportunityNote?: string;
}
