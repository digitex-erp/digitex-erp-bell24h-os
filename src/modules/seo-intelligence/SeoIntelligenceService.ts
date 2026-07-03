import { supabase } from "@/lib/supabase";
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

  async getProjects() {
    const { data, error } = await supabase.from('seo_projects').select('*');
    if (error) throw error;
    return data || [];
  }

  async getKeywords() {
    const { data, error } = await supabase.from('seo_keywords').select('*');
    if (error) throw error;
    return data || [];
  }

  async getOpportunities(projectId: string) {
    const keywords = await this.getKeywords();
    return keywords.map(kw => ({
      ...kw,
      intent: SearchIntentEngine.classify(kw.keyword),
      opportunityScore: MarketOpportunityEngine.calculateOpportunityScore(kw.search_volume, kw.difficulty)
    }));
  }
}
