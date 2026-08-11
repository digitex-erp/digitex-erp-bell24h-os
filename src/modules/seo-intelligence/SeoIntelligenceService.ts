import { supabase } from "@/lib/supabase";
import { getCurrentOrganizationId } from "@/lib/currentOrganization";
import { SearchIntentEngine } from "./SearchIntentEngine";
import { MarketOpportunityEngine } from "./MarketOpportunityEngine";

export class SeoIntelligenceService {
  private static instance: SeoIntelligenceService;

  public static getInstance(): SeoIntelligenceService {
    if (!SeoIntelligenceService.instance) {
      SeoIntelligenceService.instance = new SeoIntelligenceService();
    }
    return SeoIntelligenceService.instance;
  }

  // BR-03 P0: `seo_projects.organization_id` is enforced by RLS ("Org isolation
  // select"/"Org isolation insert", supabase_schema.sql:1411-1412) regardless of this
  // filter, so the missing filter was not itself cross-tenant-exploitable. Added as
  // defense-in-depth, matching the fix applied to AutomationService.getWorkflows().
  async getProjects() {
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error("No authenticated organization context");

    const { data, error } = await supabase
      .from('seo_projects')
      .select('*')
      .eq('organization_id', organizationId);
    if (error) throw error;
    return data || [];
  }

  // BR-03 P0: same reasoning as getProjects() — seo_keywords.organization_id is already
  // RLS-enforced; this is defense-in-depth, not a new isolation boundary.
  async getKeywords() {
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error("No authenticated organization context");

    const { data, error } = await supabase
      .from('seo_keywords')
      .select('*')
      .eq('organization_id', organizationId);
    if (error) throw error;
    return data || [];
  }

  // BR-03: `projectId` is accepted but was never applied as a filter before this change,
  // and still isn't — `seo_keywords` has no column linking a keyword row to a specific
  // seo_projects row (no project_id/project FK exists in the schema), so keywords cannot
  // be scoped to a project without a schema change, which is out of this sprint's scope.
  // This is a pre-existing correctness bug (the parameter is accepted and ignored), not a
  // tenant-isolation defect — getKeywords() above is already organization-scoped, so the
  // result is a caller's own organization's keywords, not another organization's data.
  // Reported, not fixed — see BR-03-SECURITY-REMEDIATION-REPORT.md §4.
  async getOpportunities(projectId: string) {
    const keywords = await this.getKeywords();
    return keywords.map(kw => ({
      ...kw,
      intent: SearchIntentEngine.classify(kw.keyword),
      opportunityScore: MarketOpportunityEngine.calculateOpportunityScore(kw.search_volume, kw.difficulty)
    }));
  }
}
