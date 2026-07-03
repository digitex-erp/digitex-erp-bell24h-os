import { supabase } from "@/lib/supabase";
import { JobOrchestratorService } from "./JobOrchestratorService";

export class JobWorker {
  private static instance: JobWorker;
  private intervalId: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): JobWorker {
    if (!this.instance) {
      this.instance = new JobWorker();
    }
    return this.instance;
  }

  start() {
    if (this.intervalId) return;
    console.log("JobWorker started");
    this.intervalId = setInterval(() => this.processNext(), 5000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("JobWorker stopped");
    }
  }

  private async processNext() {
    const { data: job, error } = await supabase
      .from('job_queue')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (error || !job) return;

    console.log(`Processing job ${job.id}`);
    await JobOrchestratorService.getInstance().processJob(job, job.created_by);
  }
}
