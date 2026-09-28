import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { pipelineWarnings } from "@/lib/communicationsFlow";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommDashboard } from "@/types/communications";
import { ErrorNote, formatDate, LoadingRow, StatusBadge } from "./shared";

/**
 * Every number here is a count of real rows. The warnings are derived from those counts and can only
 * say something is wrong — this page never claims the pipeline is "healthy".
 */
export function DashboardTab() {
  const [d, setD] = useState<CommDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setD(await communicationsApi.getDashboard());
    } catch (e) {
      setD(null);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const warnings = d ? pipelineWarnings(d.providers, d.worker) : [];
  const total24 = d ? Object.values(d.messages.last24h).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Live counts from the message log, campaign table and job queue. Test sends are excluded from message counts.</p>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>
      <ErrorNote message={error} />
      {!d && !error && <LoadingRow />}

      {d && (
        <>
          {warnings.length > 0 && (
            <div className="space-y-2">
              {warnings.map((w) => (
                <div
                  key={w.text}
                  role="alert"
                  className={
                    w.tone === "danger"
                      ? "flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300"
                      : "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"
                  }
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {w.text}
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Messages, last 24 hours</CardTitle>
                <CardDescription>{total24} message(s) created</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {total24 === 0 && <span className="text-sm text-muted-foreground">No messages in the last 24 hours.</span>}
                {Object.entries(d.messages.last24h).map(([status, n]) => (
                  <span key={status} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <StatusBadge status={status} /> <strong>{n}</strong>
                  </span>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Send quota (rolling 24 h)</CardTitle>
                <CardDescription>Per organization and channel. Test sends count.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {d.quota.map((q) => (
                  <div key={q.channel} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="capitalize">{q.channel}</span>
                      <span className="text-muted-foreground">
                        {q.used} / {q.limit}
                      </span>
                    </div>
                    <Progress value={q.limit === 0 ? 100 : Math.min(100, Math.round((q.used / q.limit) * 100))} />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Campaigns</CardTitle>
                <CardDescription>
                  {d.scheduled.count > 0 ? `${d.scheduled.count} scheduled · next ${formatDate(d.scheduled.nextAt)}` : "Nothing scheduled"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {Object.keys(d.campaigns).length === 0 && <span className="text-sm text-muted-foreground">No campaigns yet.</span>}
                {Object.entries(d.campaigns).map(([status, n]) => (
                  <span key={status} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                    <StatusBadge status={status} /> <strong>{n}</strong>
                  </span>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Providers</CardTitle>
                <CardDescription>Configured is not verified. Verified means a real message was sent.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Configured rows" value={d.providers.total} />
                <Stat label="Can send (not stub)" value={d.providers.canSend} />
                <Stat label="Credential set" value={d.providers.credentialsConfigured} />
                <Stat label="Verified by a send" value={d.providers.verified} />
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Worker evidence</CardTitle>
                <CardDescription>
                  This console cannot see the scheduler. The only proof the trigger works is communication jobs actually completing.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
                <Stat label="Jobs waiting" value={d.worker.queuedJobs} />
                <Stat label="Running" value={d.worker.runningJobs} />
                <Stat label="Dead-lettered" value={d.worker.deadLetterJobs} />
                <div className="rounded-md border p-3 sm:col-span-2">
                  <div className="font-medium">{d.worker.lastJobCompletedAt ? formatDate(d.worker.lastJobCompletedAt) : "never"}</div>
                  <div className="text-xs text-muted-foreground">last job completed</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
