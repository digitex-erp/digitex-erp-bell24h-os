import { supabase } from "@/lib/supabase";

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

  // processJob() and its private handleFailure() helper were removed (P0 cleanup,
  // 2026-10-25): this was the ONLY call path into AIManagerService.generateImage/
  // generateVideo/generate from the browser, bypassing the server-side ProviderRouter
  // (server/ai/ProviderRouter.ts) and its budget/circuit-breaker/credential controls
  // entirely. Its only caller, JobWorker, was never started in production (its
  // instantiation in src/main.tsx was commented out, confirmed by git history and a
  // repo-wide grep for every reference before this removal). Real job execution
  // happens server-side via QueueManager/WorkerRegistry, which this class's own
  // enqueueJob() above already feeds correctly -- nothing calls processJob() for an
  // actual job today, so removing it changes no active workflow.
  //
  // AiProviderService.ts itself (AIManagerService) is NOT removed -- it has
  // independent, live callers in AiProvidersPage.tsx and PromptStudioPage.tsx for
  // provider testing/prompt iteration, which this cleanup does not touch.
}
