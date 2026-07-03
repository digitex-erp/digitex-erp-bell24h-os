import { supabase } from "@/lib/supabase";
import { AIManagerService } from "@/modules/ai-providers/AiProviderService";

export type JobType = 'content' | 'image' | 'video' | 'voice' | 'publishing' | 'seo' | 'automation' | 'analytics';
export type JobStatus = 'queued' | 'scheduled' | 'preparing' | 'running' | 'paused' | 'retrying' | 'completed' | 'cancelled' | 'failed';

export interface Job {
  id: string;
  organization_id: string;
  status: JobStatus;
  job_type: JobType;
  payload: any;
  priority: 'critical' | 'high' | 'medium' | 'low';
  retry_count: number;
  max_retries: number;
}

export class JobOrchestratorService {
  private static instance: JobOrchestratorService;

  public static getInstance(): JobOrchestratorService {
    if (!JobOrchestratorService.instance) {
      JobOrchestratorService.instance = new JobOrchestratorService();
    }
    return JobOrchestratorService.instance;
  }

  async enqueueJob(organization_id: string, job_type: JobType, payload: any, priority: 'critical' | 'high' | 'medium' | 'low' = 'medium', dependencies: string[] = []) {
    const { data: job, error } = await supabase.from('job_queue').insert({
      organization_id,
      job_type,
      payload,
      priority,
      status: 'queued'
    }).select().single();

    if (error) throw error;

    if (dependencies.length > 0) {
      const deps = dependencies.map(depId => ({ job_id: job.id, depends_on_job_id: depId }));
      await supabase.from('job_dependencies').insert(deps);
    }
    
    return job;
  }

  async processJob(job: Job, userId: string): Promise<any> {
    // 1. Check dependencies
    const { data: deps } = await supabase.from('job_dependencies')
      .select('depends_on_job_id')
      .eq('job_id', job.id);
      
    if (deps && deps.length > 0) {
      const depIds = deps.map(d => d.depends_on_job_id);
      const { data: incompleteDeps } = await supabase.from('job_queue')
        .select('id')
        .in('id', depIds)
        .neq('status', 'completed');
        
      if (incompleteDeps && incompleteDeps.length > 0) {
        throw new Error("Dependencies not met");
      }
    }

    // 2. Process based on type
    const manager = AIManagerService.getInstance();
    
    try {
      await supabase.from('job_queue').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job.id);
      
      let result;
      switch (job.job_type) {
        case 'image':
          result = await manager.generateImage(job.payload, userId);
          break;
        case 'video':
          result = await manager.generateVideo(job.payload, userId);
          break;
        case 'content':
        case 'seo':
          result = await manager.generate(job.payload.prompt, userId);
          break;
        default:
          throw new Error(`Unsupported job type: ${job.job_type}`);
      }

      await supabase.from('job_queue').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', job.id);
      return result;
    } catch (error: any) {
      await this.handleFailure(job, error);
      throw error;
    }
  }

  private async handleFailure(job: Job, error: any) {
    const nextStatus = job.retry_count < job.max_retries ? 'retrying' : 'failed';
    
    await supabase.from('job_queue').update({ 
      status: nextStatus,
      retry_count: job.retry_count + 1
    }).eq('id', job.id);
    
    await supabase.from('job_logs').insert({
      job_id: job.id,
      level: 'error',
      message: error.message,
      metadata: { error }
    });
  }
}
