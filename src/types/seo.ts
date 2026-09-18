/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BELL24H-OS ENTERPRISE SEO INTELLIGENCE PLATFORM - TYPES
 * Strongly-typed domain models for 18 Database Tables & 12 Enterprise Suites.
 */

export type KeywordIntent = 'Informational' | 'Commercial' | 'Transactional' | 'Navigational';
export type DeviceType = 'desktop' | 'mobile' | 'local';
export type SeverityLevel = 'critical' | 'warning' | 'notice';
export type IssueCategory = 'Indexability' | 'Metadata' | 'Content' | 'Performance' | 'Links' | 'Security' | 'Schema' | 'Mobile';
export type GapType = 'missing_keyword' | 'missing_topic' | 'missing_schema' | 'missing_backlink' | 'striking_distance';
export type OverlapStatus = 'shared' | 'competitor_only' | 'we_outrank' | 'they_outrank';
export type LinkType = 'dofollow' | 'nofollow' | 'sponsored' | 'ugc';
export type AIEngine = 'chatgpt' | 'claude' | 'gemini' | 'perplexity' | 'grok' | 'google_aio';
export type SchemaEntityType = 'Product' | 'Organization' | 'LocalBusiness' | 'FAQPage' | 'Article' | 'HowTo' | 'Event' | 'VideoObject' | 'BreadcrumbList' | 'Review' | 'FAQ' | 'Breadcrumb';

// 1. seo_projects
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

// 2. seo_keywords
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

// 3. seo_keyword_groups
export interface SeoKeywordGroup {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  parent_topic: string;
  primary_intent: KeywordIntent;
  total_search_volume: number;
  average_difficulty: number;
  keyword_count?: number;
  created_at: string;
  updated_at?: string;
}

// Alias for backwards compatibility
export type KeywordCluster = SeoKeywordGroup & { cluster_name: string; intent_primary: KeywordIntent };

// 4. seo_keyword_rankings
export interface SeoKeywordRanking {
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
  cadence?: 'daily' | 'weekly' | 'monthly';
  country: string;
  recorded_at: string;
}

// Alias for backwards compatibility
export type SeoRanking = SeoKeywordRanking;

// 5. seo_site_audits
export interface SeoSiteAudit {
  id: string;
  organization_id: string;
  project_id: string;
  audit_type: string;
  health_score: number;
  score?: number; // Backward compatibility alias
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
  crawl_depth?: number;
  status?: string;
  duration_seconds?: number;
  issues_json?: SeoAuditIssue[];
  completed_at?: string;
  created_at: string;
  updated_at?: string;
}

// Alias for backwards compatibility
export type SeoAudit = SeoSiteAudit;

// 6. seo_audit_issues
export interface SeoAuditIssue {
  id: string;
  organization_id?: string;
  audit_id?: string;
  issue_type: string;
  severity: SeverityLevel;
  category: IssueCategory;
  message: string;
  page_url: string;
  how_to_fix?: string;
  is_resolved?: boolean;
  resolved_at?: string;
  created_at?: string;
}

// Alias for backwards compatibility
export type SeoIssue = SeoAuditIssue;

// 7. seo_meta_tags
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
  ai_optimization_status?: string;
  ctr_score?: number;
  created_at: string;
  updated_at: string;
}

// 8. seo_backlinks
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
  toxicity_score?: number;
  is_lost: boolean;
  first_seen: string;
  last_seen: string;
}

// 9. seo_competitors
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

// 10. seo_competitor_keywords
export interface SeoCompetitorKeyword {
  id: string;
  organization_id: string;
  project_id: string;
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
  search_volume: number;
  difficulty: number;
  gap_type: GapType;
  opportunity_score: number;
  created_at: string;
}

// 11. seo_content_scores
export interface SeoContentScore {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  title: string;
  word_count: number;
  overall_content_score: number;
  content_score?: number; // Alias
  readability_score: number;
  semantic_coverage_pct: number;
  entity_coverage_pct: number;
  keyword_density_pct: number;
  topic_authority_score: number;
  eeat_signals_score: number;
  nlp_entities?: string[];
  nlp_keywords?: string[]; // Alias
  missing_topics?: string[];
  recommendations?: string[];
  traffic_potential?: string;
  topic_cluster?: string;
  topical_coverage_pct?: number; // Alias
  last_analyzed_at?: string;
  last_crawled_at?: string; // Alias
  created_at: string;
  updated_at?: string;
}

// Alias for backwards compatibility
export type SeoContentAnalysis = SeoContentScore;

// 12. seo_schema_templates
export interface SeoSchemaTemplate {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  entity_type: SchemaEntityType;
  schema_json: Record<string, any>;
  validation_status: 'valid' | 'warning' | 'invalid';
  validation_errors?: string[];
  created_at: string;
  updated_at?: string;
}

// Alias for backwards compatibility
export type SeoSchema = SeoSchemaTemplate;
export type SeoSchemaMarkup = SeoSchemaTemplate;

// 13. seo_broken_links
export interface SeoBrokenLink {
  id: string;
  organization_id: string;
  project_id: string;
  page_url: string;
  target_url: string;
  link_type: 'internal' | 'external' | 'asset';
  status_code: number;
  error_type: '404' | '500' | 'redirect_loop' | 'missing_asset' | 'timeout';
  is_resolved: boolean;
  resolved_at?: string;
  detected_at: string;
}

// 14. seo_local_profiles
export interface SeoLocalProfile {
  id: string;
  organization_id: string;
  project_id: string;
  location_name: string;
  hub_city: string;
  google_business_status: string;
  address?: string;
  phone?: string;
  review_count: number;
  average_rating: number;
  nap_consistency_score: number;
  local_rank: number;
  map_pack_presence: boolean;
  citations_count: number;
  created_at: string;
  updated_at: string;
}

// Alias for backwards compatibility
export type SeoLocalRanking = SeoLocalProfile;

// 15. seo_geo_audits
export interface SeoGeoAudit {
  id: string;
  organization_id: string;
  project_id: string;
  target_url: string;
  geo_score: number;
  citation_score?: number;
  authority_score: number;
  structure_score: number;
  answerability_score?: number;
  chatgpt_readiness: number;
  claude_readiness: number;
  gemini_readiness: number;
  perplexity_readiness: number;
  google_aio_readiness?: number;
  citation_probability: number;
  eeat_score?: number;
  ai_visibility_score?: number;
  missing_entities: string[];
  missing_citations: string[];
  missing_schema?: string[];
  recommendations: string[];
  audited_at: string;
}

// 16. seo_geo_citations
export interface SeoGeoCitation {
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

// Alias for backwards compatibility
export type SeoCitation = SeoGeoCitation;

// 17. seo_reports
export interface SeoReport {
  id: string;
  organization_id: string;
  project_id: string;
  report_type: 'executive_summary' | 'technical_audit' | 'keyword_universe' | 'geo_readiness' | 'backlink_profile';
  title: string;
  format: 'csv' | 'pdf' | 'json';
  file_url?: string;
  payload?: Record<string, any>;
  generated_at: string;
}

// 18. seo_alerts
export interface SeoAlert {
  id: string;
  organization_id: string;
  project_id: string;
  alert_type: 'ranking_drop' | 'geo_score_drop' | 'broken_link' | 'toxic_backlink' | 'competitor_spike';
  severity: SeverityLevel;
  title: string;
  description: string;
  status: 'active' | 'acknowledged' | 'resolved';
  triggered_at: string;
  resolved_at?: string;
}

// Additional Domain Models (Content Briefs, Automation Tasks, Trends, Scorecard)
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

export interface SeoTrendPoint {
  date: string;
  rankingAvg: number;
  organicTraffic: number;
  geoScore: number;
  citationsCount: number;
  backlinksCount: number;
}

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
