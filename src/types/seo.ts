/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BELL24H-OS ENTERPRISE SEO CENTER v3.0 - TYPES
 * Strongly-typed domain models for 15 Database Tables & 12 Enterprise Suites.
 */

export type KeywordIntent = 'Informational' | 'Commercial' | 'Transactional' | 'Navigational';
export type DeviceType = 'desktop' | 'mobile' | 'local';
export type SeverityLevel = 'critical' | 'warning' | 'notice';
export type IssueCategory = 'Indexability' | 'Metadata' | 'Content' | 'Performance' | 'Links' | 'Security' | 'Schema' | 'Mobile';
export type GapType = 'missing_keyword' | 'missing_topic' | 'missing_schema' | 'missing_backlink' | 'striking_distance';
export type OverlapStatus = 'shared' | 'competitor_only' | 'we_outrank' | 'they_outrank';
export type LinkType = 'dofollow' | 'nofollow' | 'sponsored' | 'ugc';
export type AIEngine = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'google_aio';
export type SchemaEntityType = 'Product' | 'Organization' | 'LocalBusiness' | 'FAQPage' | 'Article' | 'HowTo' | 'Event' | 'VideoObject' | 'BreadcrumbList' | 'Review';

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

// 2. Keyword Clusters
export interface KeywordCluster {
  id: string;
  organization_id: string;
  project_id: string;
  cluster_name: string;
  parent_topic: string;
  intent_primary: KeywordIntent;
  total_search_volume: number;
  average_difficulty: number;
  keyword_count?: number;
  created_at: string;
}

// 3. Keywords & Rankings
export interface SeoKeyword {
  id: string;
  organization_id: string;
  project_id: string;
  cluster_id?: string;
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

export interface SeoRanking {
  id: string;
  organization_id: string;
  project_id: string;
  keyword_id: string;
  keyword_text?: string;
  position: number;
  previous_position?: number | null;
  url?: string;
  search_engine: 'google' | 'bing';
  device: DeviceType;
  country: string;
  recorded_at: string;
}

// Aliases for backward compatibility
export type SeoKeywordRanking = SeoRanking;

// 4. Technical Site Audits
export interface SeoAuditIssue {
  id: string;
  organization_id?: string;
  issue_type: string;
  severity: SeverityLevel;
  category: IssueCategory;
  message: string;
  page_url: string;
  how_to_fix?: string;
  is_resolved?: boolean;
  created_at?: string;
}

export interface SeoAudit {
  id: string;
  organization_id: string;
  project_id: string;
  audit_type: string;
  health_score: number;
  score?: number; // Backward compatibility alias for health_score
  pages_crawled: number;
  total_pages_crawled?: number;
  issues_critical: number;
  critical_errors_count?: number;
  issues_warnings: number;
  warnings_count?: number;
  issues_notices: number;
  notices_count?: number;
  core_web_vitals_status: string;
  avg_lcp_ms: number;
  avg_fid_ms: number;
  avg_cls: number;
  duration_seconds?: number;
  status?: string;
  issues_json?: SeoAuditIssue[];
  completed_at: string;
  created_at: string;
}

// Backward compatibility alias
export type SeoSiteAudit = SeoAudit;
export type SeoIssue = SeoAuditIssue;

// 5. Meta Tag Management
export interface SeoMetaTag {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  title: string;
  description: string;
  meta_description?: string; // Backward compatibility alias
  canonical_url?: string;
  robots_directive?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  og_type?: string;
  twitter_card?: string;
  ctr_score?: number;
  ai_optimization_status?: string;
  created_at: string;
  updated_at: string;
}

// 6. Schema Markup Management
export interface SeoSchema {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  entity_type: SchemaEntityType;
  schema_json: Record<string, any>;
  validation_status: 'valid' | 'warning' | 'invalid';
  validation_errors?: string[];
  created_at: string;
  updated_at: string;
}

// Backward compatibility alias
export type SeoSchemaMarkup = SeoSchema;

// 7. Content Analysis & Inventory
export interface SeoContentAnalysis {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  title: string;
  word_count: number;
  topic_cluster?: string;
  content_score: number;
  topical_coverage_pct: number;
  entity_coverage_pct: number;
  nlp_keywords: string[];
  missing_topics: string[];
  traffic_potential: string;
  last_crawled_at: string;
  created_at: string;
}

// 8. Content Brief Generator
export interface SeoContentBrief {
  id: string;
  organization_id: string;
  project_id: string;
  target_topic: string;
  target_intent: KeywordIntent;
  target_word_count: number;
  target_keywords: string[];
  heading_outline: { heading: string; level: number; intent: string }[];
  suggested_faqs: { question: string; answer_guideline: string }[];
  internal_linking_suggestions: string[];
  eeat_guidelines?: string;
  created_at: string;
}

// 9. Competitor Intelligence
export interface SeoCompetitor {
  id: string;
  organization_id: string;
  project_id: string;
  domain: string;
  name?: string;
  authority_score: number;
  organic_traffic_estimate: number;
  keywords_count: number;
  ranking_overlap_count?: number;
  content_gaps_count?: number;
  backlink_gaps_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface SeoContentGap {
  id: string;
  organization_id: string;
  project_id: string;
  competitor_id: string;
  keyword: string;
  competitor_url?: string;
  search_volume: number;
  difficulty: number;
  gap_type: GapType;
  opportunity_score: number;
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

// 10. Backlink Intelligence
export interface SeoBacklink {
  id: string;
  organization_id: string;
  project_id: string;
  source_url: string;
  target_url: string;
  anchor_text: string;
  authority_score: number;
  link_type: LinkType;
  is_toxic: boolean;
  is_lost: boolean;
  first_seen: string;
  last_seen: string;
}

// 11. Local SEO & Cluster Rankings
export interface SeoLocalRanking {
  id: string;
  organization_id: string;
  project_id: string;
  location_name: string;
  hub_city: string;
  google_business_status: string;
  review_count: number;
  average_rating: number;
  nap_consistency_score: number;
  local_rank: number;
  map_pack_presence: boolean;
  citations_count: number;
  created_at: string;
  updated_at: string;
}

// 12. GEO (Generative Engine Optimization) Audits
export interface SeoGeoAudit {
  id: string;
  organization_id: string;
  project_id: string;
  target_url: string;
  geo_score: number;
  chatgpt_readiness: number;
  claude_readiness: number;
  gemini_readiness: number;
  perplexity_readiness: number;
  citation_probability: number;
  authority_score: number;
  structure_score: number;
  eeat_score: number;
  ai_visibility_score: number;
  missing_entities: string[];
  missing_citations: string[];
  missing_schema: string[];
  recommendations: string[];
  audited_at: string;
}

// 13. Recommendations
export interface SeoRecommendation {
  id: string;
  organization_id: string;
  project_id: string;
  title: string;
  description: string;
  category: 'Keywords' | 'Technical' | 'Content' | 'Backlinks' | 'GEO' | 'Schema' | 'Local' | 'Quick Win';
  priority?: 'Critical' | 'High' | 'Medium' | 'Low';
  effort: 'Quick Win' | 'Medium' | 'High' | 'Low';
  impact: 'High' | 'Medium' | 'Low';
  estimated_traffic_lift?: string;
  is_completed?: boolean;
  status?: string;
  action_plan?: string[];
  created_at: string;
}

// 14. Automation Tasks
export interface SeoTask {
  id: string;
  organization_id: string;
  project_id: string;
  trigger_type: 'ranking_drop' | 'new_competitor' | 'broken_link' | 'missing_meta' | 'geo_score_drop';
  action_type: 'notify_admin' | 'create_task' | 'generate_content' | 'auto_fix';
  threshold_value?: string;
  status: 'active' | 'paused' | 'completed';
  last_triggered_at?: string;
  execution_payload?: Record<string, any>;
  created_at: string;
}

// Historical & Trend Models
export interface SeoTrendPoint {
  date: string;
  rankingAvg: number;
  organicTraffic: number;
  geoScore: number;
  citationsCount: number;
  backlinksCount: number;
}

// Executive Scorecard
export interface SeoScorecard {
  healthScore: number;
  totalKeywords: number;
  rankingKeywords?: number;
  trackedKeywords?: number;
  top3Keywords?: number;
  top3Count?: number;
  top10Keywords?: number;
  top10Count?: number;
  strikingDistanceCount?: number;
  averagePosition: number;
  visibilityScore?: number;
  totalBacklinks: number;
  referringDomains: number;
  technicalErrors?: number;
  criticalIssuesCount?: number;
  indexedPages?: number;
  ctrEstimate?: number;
  monthlyImpressions?: number;
  organicTraffic?: number;
  aiVisibilityScore?: number;
  geoScore?: number;
  totalAiCitations?: number;
}

// Backward compatibility types
export interface SeoSitemap {
  id: string;
  organization_id: string;
  project_id: string;
  sitemap_url: string;
  total_urls: number;
  valid_urls?: number;
  error_urls?: number;
  status: string;
  gsc_status?: string;
  last_submitted_at?: string;
  created_at?: string;
}

export interface SeoRedirect {
  id: string;
  organization_id: string;
  project_id: string;
  source_path: string;
  target_url: string;
  status_code: 301 | 302;
  hits_count: number;
  is_active: boolean;
  has_loop?: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
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
  lcp_ms: number;
  fid_ms: number;
  cls_score: number;
  created_at: string;
}

export interface SeoAiVisibility {
  id: string;
  organization_id: string;
  project_id: string;
  engine: string;
  target_query: string;
  mention_position: number;
  is_cited?: boolean;
  cited_snippet?: string;
  source_url?: string;
  tracked_at: string;
}

export interface SeoCitation {
  id: string;
  organization_id: string;
  project_id: string;
  engine: string;
  query: string;
  quotation_text: string;
  cited_url: string;
  is_verified: boolean;
  evidence_score: number;
  created_at: string;
}
