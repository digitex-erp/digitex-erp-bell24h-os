import { supabase } from "@/lib/supabase";

export interface PerformanceMetric {
  views: number;
  reach: number;
  conversions: number;
  roi: number;
  ctr: number;
}

export interface Recommendation {
  id: string;
  category: string;
  title: string;
  description: string;
  confidence_score: number;
  status: 'pending' | 'applied' | 'dismissed';
}

export interface LearningInsight {
  id: string;
  model_type: string;
  insights: any;
  last_trained_at: string;
}

export class PerformanceIntelligenceService {
  private static instance: PerformanceIntelligenceService;

  public static getInstance(): PerformanceIntelligenceService {
    if (!PerformanceIntelligenceService.instance) {
      PerformanceIntelligenceService.instance = new PerformanceIntelligenceService();
    }
    return PerformanceIntelligenceService.instance;
  }

  async getExecutiveMetrics(): Promise<PerformanceMetric> {
    // Aggregated metrics across all campaigns
    const { data, error } = await supabase
      .from('campaign_performance')
      .select('metrics');
    
    if (error) throw error;

    const totals = (data || []).reduce((acc, curr: any) => ({
      views: acc.views + (curr.metrics.views || 0),
      reach: acc.reach + (curr.metrics.reach || 0),
      conversions: acc.conversions + (curr.metrics.conversions || 0),
      roi: acc.roi + (curr.metrics.roi || 0),
      ctr: acc.ctr + (curr.metrics.ctr || 0)
    }), { views: 0, reach: 0, conversions: 0, roi: 0, ctr: 0 });

    const count = data?.length || 1;
    return {
      ...totals,
      ctr: totals.ctr / count,
      roi: totals.roi / count
    };
  }

  async getRecommendations(): Promise<Recommendation[]> {
    const { data, error } = await supabase
      .from('recommendations')
      .select('*')
      .order('confidence_score', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async getLearningInsights(): Promise<LearningInsight[]> {
    const { data, error } = await supabase
      .from('learning_models')
      .select('*')
      .order('last_trained_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async applyRecommendation(id: string): Promise<void> {
    const { error } = await supabase
      .from('recommendations')
      .update({ status: 'applied' })
      .eq('id', id);
    
    if (error) throw error;
  }
}
