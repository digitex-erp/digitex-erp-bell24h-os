import { supabase } from "@/lib/supabase";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  created_at: string;
}

export interface WorkflowHistory {
  id: string;
  workflow_id: string;
  status: 'started' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  error_message?: string;
}

export class AutomationService {
  private static instance: AutomationService;

  public static getInstance(): AutomationService {
    if (!AutomationService.instance) {
      AutomationService.instance = new AutomationService();
    }
    return AutomationService.instance;
  }

  async getWorkflows(): Promise<Workflow[]> {
    const { data, error } = await supabase
      .from('automation_workflows')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data || [];
  }

  async getWorkflowHistory(limit = 10): Promise<WorkflowHistory[]> {
    const { data, error } = await supabase
      .from('workflow_history')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data || [];
  }

  async createWorkflow(workflow: Omit<Workflow, 'id' | 'created_at'>): Promise<Workflow> {
    const { data, error } = await supabase
      .from('automation_workflows')
      .insert([workflow])
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }

  async triggerWorkflow(workflowId: string): Promise<string> {
    // In a real system, this would queue a job in the background
    // For now, we simulate the start of an execution
    const { data, error } = await supabase
      .from('workflow_history')
      .insert([{
        workflow_id: workflowId,
        status: 'started',
        started_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) throw error;
    return data.id;
  }
}
