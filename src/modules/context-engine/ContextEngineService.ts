import { supabase } from "@/lib/supabase";

export interface ContextProfile {
  id: string;
  name: string;
  variables: Record<string, string>;
}

export class ContextEngineService {
  private static instance: ContextEngineService;

  public static getInstance(): ContextEngineService {
    if (!ContextEngineService.instance) {
      ContextEngineService.instance = new ContextEngineService();
    }
    return ContextEngineService.instance;
  }

  async generateContext(profileId: string): Promise<Record<string, string>> {
    const { data: profile, error } = await supabase
      .from('context_profiles')
      .select('name, context_variables(key, value)')
      .eq('id', profileId)
      .single();

    if (error || !profile) throw error || new Error("Profile not found");

    const variables: Record<string, string> = {};
    (profile.context_variables as any[]).forEach(v => {
      variables[v.key] = v.value;
    });

    return variables;
  }
}
