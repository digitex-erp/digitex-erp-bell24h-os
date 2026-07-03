import { supabase } from "@/lib/supabase";

export interface MediaPackage {
  id: string;
  project_id: string;
  package_type: string;
  status: string;
}

export class MediaComposerService {
  private static instance: MediaComposerService;

  public static getInstance(): MediaComposerService {
    if (!MediaComposerService.instance) {
      MediaComposerService.instance = new MediaComposerService();
    }
    return MediaComposerService.instance;
  }

  async getPackages(): Promise<MediaPackage[]> {
    const { data, error } = await supabase.from('media_packages').select('*');
    if (error) throw error;
    return data || [];
  }

  async createPackage(pkg: Omit<MediaPackage, 'id'>): Promise<MediaPackage> {
    const { data, error } = await supabase.from('media_packages').insert([pkg]).select().single();
    if (error) throw error;
    return data;
  }
}
