import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Activity, AlertCircle, PlayCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function JobOrchestratorPage() {
  const { user } = useAuthStore();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({ queueSize: 0, running: 0, failures: 0 });

  useEffect(() => {
    if (user) {
      fetchJobs();
      const interval = setInterval(fetchJobs, 5000);
      return () => clearInterval(interval);
    }
  }, [user]);

  async function fetchJobs() {
    try {
      const { data: orgData } = await supabase.from('profiles').select('organization_id').eq('id', user?.id).single();
      if (!orgData?.organization_id) return;
      
      const { data, error } = await supabase.from('job_queue')
        .select('*')
        .eq('organization_id', orgData.organization_id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setJobs(data || []);
      
      // Calculate metrics
      const qSize = data?.filter(j => j.status === 'queued').length || 0;
      const run = data?.filter(j => j.status === 'running').length || 0;
      const fail = data?.filter(j => j.status === 'failed').length || 0;
      setMetrics({ queueSize: qSize, running: run, failures: fail });
      
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function getStatusBadge(status: string) {
    switch(status) {
      case 'completed': return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'running': return <Badge className="bg-blue-100 text-blue-800">Running</Badge>;
      case 'queued': return <Badge className="bg-gray-100 text-gray-800">Queued</Badge>;
      case 'failed': return <Badge className="bg-red-100 text-red-800">Failed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Activity className="w-6 h-6" /> Job Orchestrator</h1>
        <Button variant="outline" size="sm" onClick={fetchJobs}><RefreshCw className="w-4 h-4 mr-2" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Queued Jobs</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold">{metrics.queueSize}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Running Jobs</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-blue-600">{metrics.running}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Failures</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold text-red-600">{metrics.failures}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Retry</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(job => (
                  <TableRow key={job.id}>
                    <TableCell>{getStatusBadge(job.status)}</TableCell>
                    <TableCell className="capitalize">{job.job_type}</TableCell>
                    <TableCell className="capitalize">{job.priority}</TableCell>
                    <TableCell>{job.retry_count} / {job.max_retries}</TableCell>
                    <TableCell>{new Date(job.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
