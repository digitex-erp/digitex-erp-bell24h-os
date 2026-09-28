import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommSchedule, CommWorkerEvidence } from "@/types/communications";
import { CampaignDetailDialog } from "./CampaignDetailDialog";
import { EmptyState, ErrorNote, formatDate, LoadingRow, StatusBadge, ToneBadge } from "./shared";

/**
 * Campaigns that are scheduled or in progress, with the queue job that starts them. A scheduled campaign
 * only starts when something calls the worker (an InsForge schedule -> GET /api/v1/workers/tick). If a
 * job is past due and still waiting, it is flagged OVERDUE — evidence the trigger is not running.
 */
export function SchedulesTab({ onViewLogs }: { onViewLogs: (campaignId: string) => void }) {
  const [rows, setRows] = useState<CommSchedule[] | null>(null);
  const [worker, setWorker] = useState<CommWorkerEvidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await communicationsApi.listSchedules();
      setRows(r.schedules);
      setWorker(r.worker);
    } catch (e) {
      setRows(null);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Schedules</CardTitle>
            <CardDescription>Scheduled, running and paused campaigns and the job that drives each one.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorNote message={error} />
          {rows === null && !error && <LoadingRow />}
          {rows && rows.length === 0 && <EmptyState title="Nothing scheduled or running" hint="Schedule a campaign from the Campaigns tab after a test message has been sent." />}
          {rows && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Run job</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.channel_type}</div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.status} />
                      {s.paused_reason && <div className="mt-1 text-xs text-muted-foreground">paused: {s.paused_reason}</div>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(s.scheduled_at)}</TableCell>
                    <TableCell>
                      {s.job_status ? <StatusBadge status={s.job_status} /> : <span className="text-muted-foreground">no job</span>}
                      {s.overdue && (
                        <ToneBadge tone="danger" className="ml-2">
                          overdue — trigger not running?
                        </ToneBadge>
                      )}
                      {s.job_due_at && <div className="mt-1 text-xs text-muted-foreground">due {formatDate(s.job_due_at)}</div>}
                    </TableCell>
                    <TableCell className="text-right">{s.total_recipients}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Worker trigger</CardTitle>
          <CardDescription>How scheduled campaigns actually start</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Scheduling only records <em>when</em> a campaign should start. Nothing sends until a scheduler calls <code>GET /api/v1/workers/tick</code> with the server's cron
            secret. The intended scheduler is an InsForge schedule (see <code>docs/project/CH02_INSFORGE_WORKER_SCHEDULE_RUNBOOK.md</code>).
          </p>
          <p className="text-muted-foreground">
            This console cannot see InsForge. Evidence that the trigger works:{" "}
            {worker?.lastJobCompletedAt ? (
              <strong className="text-foreground">a communication job last completed {formatDate(worker.lastJobCompletedAt)}.</strong>
            ) : (
              <strong className="text-foreground">no communication job has ever completed.</strong>
            )}{" "}
            {worker && worker.queuedJobs > 0 && `${worker.queuedJobs} job(s) are waiting.`}
          </p>
        </CardContent>
      </Card>

      <CampaignDetailDialog
        campaignId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
        onViewLogs={(id) => {
          setOpenId(null);
          onViewLogs(id);
        }}
      />
    </div>
  );
}
