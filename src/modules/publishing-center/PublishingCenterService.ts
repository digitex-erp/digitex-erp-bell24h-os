import { supabase } from "@/lib/supabase";

export interface PublishingQueueItem {
  id: string;
  media_package_id: string;
  channel_id: string;
  status: string;
  scheduled_at?: string;
}

export class PublishingCenterService {
  private static instance: PublishingCenterService;

  public static getInstance(): PublishingCenterService {
    if (!PublishingCenterService.instance) {
      PublishingCenterService.instance = new PublishingCenterService();
    }
    return PublishingCenterService.instance;
  }

  async getQueue(): Promise<PublishingQueueItem[]> {
    const { data, error } = await supabase.from('publishing_queue').select('*');
    if (error) throw error;
    return data || [];
  }

  async enqueuePublishingTask(item: Omit<PublishingQueueItem, 'id'>): Promise<PublishingQueueItem> {
    const { data, error } = await supabase.from('publishing_queue').insert([item]).select().single();
    if (error) throw error;
    return data;
  }
}
