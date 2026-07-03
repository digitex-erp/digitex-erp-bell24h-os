import { supabase } from "@/lib/supabase";

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
}
