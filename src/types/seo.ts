/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BELL24H-OS ENTERPRISE SEO CENTER v2.0 - TYPES
 * Strongly-typed domain models for 23 SEO & GEO Sub-Modules.
 */

export type KeywordIntent = 'Informational' | 'Commercial' | 'Transactional' | 'Navigational';
export type DeviceType = 'desktop' | 'mobile' | 'tablet';
export type SeverityLevel = 'critical' | 'warning' | 'notice';
export type IssueCategory = 'Indexability' | 'Metadata' | 'Content' | 'Performance' | 'Links' | 'Security' | 'Schema' | 'Mobile';
export type GapType = 'missing_keyword' | 'missing_topic' | 'missing_schema' | 'missing_backlink' | 'striking_distance';
export type OverlapStatus = 'shared' | 'competitor_only' | 'we_outrank' | 'they_outrank';
export type LinkType = 'dofollow' | 'nofollow' | 'sponsored' | 'ugc';
export type AIEngine = 'chatgpt' | 'perplexity' | 'gemini' | 'claude' | 'google_aio';
export type SchemaEntityType = 'Product' | 'Organization' | 'LocalBusiness' | 'FAQPage' | 'HowTo' | 'Article' | 'BreadcrumbList' | 'WebSite';

// 1. Project
export interface SeoProject {
  id: string;
  organization_id: string;
  name: string;
  domain: string;
  target_country: string;
  target_language: string;
  industry_id?: string;
  settings?: {
    crawler_depth?: number;
    auto_audit_frequency?: 'daily' | 'weekly' | 'monthly';
    track_ai_citations?: boolean;
    primary_competitors?: string[];
  };
  created_at: string;
  updated_at: string;
}

// 2. Keywords & Rankings
export interface SeoKeyword {
  id: string;
  organization_id: string;
  project_id: string;
  keyword: string;
  search_volume: number;
  difficulty: number;
  cpc: number;
  intent: KeywordIntent;
  cluster_name?: string;
  parent_topic?: string;
  is_tracked: boolean;
  current_position?: number | null;
  previous_position?: number | null;
  opportunity_score: number;
  created_at: string;
  updated_at: string;
}

export interface SeoKeywordRanking {
  id: string;
  organization_id: string;
  keyword_id: string;
  position: number;
  previous_position?: number | null;
  url?: string;
  search_engine: string;
  device: DeviceType;
  country: string;
  recorded_at: string;
}

// 3. Competitor Intelligence
export interface SeoCompetitor {
  id: string;
  organization_id: string;
  project_id: string;
  domain: string;
  name?: string;
  authority_score: number;
  organic_traffic_estimate: number;
  keywords_count: number;
  created_at: string;
}

export interface SeoCompetitorKeyword {
  id: string;
  organization_id: string;
  competitor_id: string;
  keyword: string;
  position: number;
  search_volume: number;
  url?: string;
  overlap_status: OverlapStatus;
  created_at: string;
}

export interface SeoContentGap {
  id: string;
  organization_id: string;
  project_id: string;
  competitor_id: string;
  keyword: string;
  competitor_url?: string;
  our_url?: string;
  gap_type: GapType;
  opportunity_score: number;
  search_volume: number;
  difficulty: number;
  created_at: string;
}

// 4. Backlinks & Internal Links
export interface SeoBacklink {
  id: string;
  organization_id: string;
  project_id: string;
  source_url: string;
  target_url: string;
  anchor_text?: string;
  authority_score: number;
  link_type: LinkType;
  is_toxic: boolean;
  is_lost: boolean;
  first_seen: string;
  last_seen: string;
}

export interface InternalLinkItem {
  source_url: string;
  target_url: string;
  anchor_text: string;
  status: 'active' | 'broken' | 'redirect';
  inbound_count: number;
  outbound_count: number;
}

// 5. Technical Audits & Issues
export interface SeoSiteAudit {
  id: string;
  organization_id: string;
  project_id: string;
  audit_type: 'full_crawl' | 'quick_scan' | 'technical_only' | 'mobile_only';
  score: number;
  total_pages_crawled: number;
  critical_errors_count: number;
  warnings_count: number;
  notices_count: number;
  duration_seconds: number;
  status: 'queued' | 'running' | 'completed' | 'failed';
  created_at: string;
}

export interface SeoPageAudit {
  id: string;
  organization_id: string;
  audit_id: string;
  url: string;
  status_code: number;
  load_time_ms: number;
  title?: string;
  meta_description?: string;
  h1?: string;
  canonical_url?: string;
  word_count: number;
  internal_links_count: number;
  external_links_count: number;
  is_indexable: boolean;
  issues_count: number;
  created_at: string;
}

export interface SeoIssue {
  id: string;
  organization_id: string;
  audit_id?: string;
  page_url: string;
  issue_type: string;
  severity: SeverityLevel;
  category: IssueCategory;
  message: string;
  how_to_fix?: string;
  is_resolved: boolean;
  resolved_at?: string;
  created_at: string;
}

// 6. Schema, Sitemaps, Redirects, Meta Tags
export interface SeoSchemaMarkup {
  id: string;
  organization_id: string;
  project_id: string;
  entity_type: SchemaEntityType;
  entity_id?: string;
  page_url?: string;
  schema_json: Record<string, any>;
  validation_status: 'valid' | 'warnings' | 'invalid';
  validation_errors?: string[];
  created_at: string;
  updated_at: string;
}

export interface SeoSitemap {
  id: string;
  organization_id: string;
  project_id: string;
  sitemap_url: string;
  total_urls: number;
  valid_urls: number;
  error_urls: number;
  last_submitted_at?: string;
  gsc_status: 'Success' | 'Pending' | 'Errors' | 'Not Submitted';
  created_at: string;
}

export interface SeoRedirect {
  id: string;
  organization_id: string;
  project_id: string;
  source_path: string;
  target_url: string;
  status_code: 301 | 302 | 307 | 308;
  is_active: boolean;
  hits_count: number;
  has_loop: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface SeoMetaTag {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  title: string;
  meta_description?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  twitter_card?: string;
  ctr_score: number;
  created_at: string;
  updated_at: string;
}

export interface SeoPagespeedReport {
  id: string;
  organization_id: string;
  project_id: string;
  url: string;
  device: 'mobile' | 'desktop';
  performance_score: number;
  accessibility_score: number;
  seo_score: number;
  best_practices_score: number;
  lcp_ms?: number;
  fid_ms?: number;
  cls_score?: number;
  created_at: string;
}

// 7. AI Visibility & GEO
export interface SeoBrandMention {
  id: string;
  organization_id: string;
  project_id: string;
  brand_name: string;
  source_url: string;
  snippet?: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  is_linked: boolean;
  link_type?: string;
  discovered_at: string;
}

export interface SeoAiVisibility {
  id: string;
  organization_id: string;
  project_id: string;
  target_query: string;
  engine: AIEngine;
  is_cited: boolean;
  mention_position?: number;
  cited_snippet?: string;
  source_url?: string;
  tracked_at: string;
}

export interface SeoCitation {
  id: string;
  organization_id: string;
  project_id: string;
  engine: AIEngine;
  query: string;
  quotation_text: string;
  cited_url: string;
  is_verified: boolean;
  evidence_score: number;
  created_at: string;
}

export interface SeoRecommendation {
  id: string;
  organization_id: string;
  project_id: string;
  category: 'Technical' | 'Content' | 'Backlinks' | 'GEO' | 'Schema' | 'Quick Win';
  title: string;
  impact: 'High' | 'Medium' | 'Low';
  effort: 'Low' | 'Medium' | 'High';
  description: string;
  action_plan?: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'dismissed';
  created_at: string;
}

// 8. Aggregate Scorecard & State
export interface SeoScorecard {
  healthScore: number;
  totalKeywords: number;
  trackedKeywords: number;
  averagePosition: number;
  top3Count: number;
  top10Count: number;
  strikingDistanceCount: number;
  totalBacklinks: number;
  referringDomains: number;
  criticalIssuesCount: number;
  aiVisibilityScore: number;
  totalAiCitations: number;
}
