import { supabase } from "@/lib/supabase";

export interface Industry {
  id: string;
  name: string;
  description: string;
}

export class IndustryIntelligenceService {
  private static instance: IndustryIntelligenceService;

  public static getInstance(): IndustryIntelligenceService {
    if (!IndustryIntelligenceService.instance) {
      IndustryIntelligenceService.instance = new IndustryIntelligenceService();
    }
    return IndustryIntelligenceService.instance;
  }

  async getIndustries(): Promise<Industry[]> {
    const { data, error } = await supabase.from('industries').select('*');
    if (error) throw error;
    return data || [];
  }

  async getCategories(industryId: string) {
    const { data, error } = await supabase.from('industry_categories').select('*').eq('industry_id', industryId);
    if (error) throw error;
    return data || [];
  }
}
