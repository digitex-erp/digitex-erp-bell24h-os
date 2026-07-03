import { supabase } from "@/lib/supabase";

export interface Campaign {
  id: string;
  name: string;
  objective: string;
  status: string;
  start_date?: string;
  end_date?: string;
}

export class CampaignManagerService {
  private static instance: CampaignManagerService;

  public static getInstance(): CampaignManagerService {
    if (!CampaignManagerService.instance) {
      CampaignManagerService.instance = new CampaignManagerService();
    }
    return CampaignManagerService.instance;
  }

  async getCampaigns(): Promise<Campaign[]> {
    const { data, error } = await supabase.from('campaigns').select('*');
    if (error) throw error;
    return data || [];
  }

  async createCampaign(campaign: Omit<Campaign, 'id'>): Promise<Campaign> {
    const { data, error } = await supabase.from('campaigns').insert([campaign]).select().single();
    if (error) throw error;
    return data;
  }
}
