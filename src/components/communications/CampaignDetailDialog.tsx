import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleDot, Circle, Ban, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { availableActions, flowSteps, localDateTimeToIso, minScheduleLocal, progressPercent, shouldPoll, type FlowStep } from "@/lib/communicationsFlow";
import { communicationsApi, errorText, newIdempotencyKey } from "@/lib/communicationsApi";
import type { CommCampaignDetail, CommRecipient } from "@/types/communications";
import { CampaignAnalyticsPanel } from "./CampaignAnalyticsPanel";
import { ErrorNote, formatDate, LoadingRow, StatusBadge } from "./shared";

const POLL_MS = 5000;
const PAGE = 50;

/**
 * Steps 3-5 of the flow: SEND TEST -> SCHEDULE -> EXECUTE (plus cancel).
 *
 * Every button is enabled from server-reported state (availableActions) and every action is re-checked by
 * the server. "Verified" comes only from a real message reaching sent/delivered — this panel never marks
 * anything as done on its own.
 */
export function CampaignDetailDialog({
  campaignId,
  onClose,
  onChanged,
  onViewLogs,
}: {
  campaignId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onViewLogs: (campaignId: string) => void;
}) {
  const [detail, setDetail] = useState<CommCampaignDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [when, setWhen] = useState("");
  const [confirm, setConfirm] = useState<"execute" | "cancel" | null>(null);
  const [recipients, setRecipients] = useState<CommRecipient[] | null>(null);
  const [recStatus, setRecStatus] = useState("all");
  const [recOffset, setRecOffset] = useState(0);
  const [recMore, setRecMore] = useState(false);
  const detailRef = useRef<CommCampaignDetail | null>(null);
  detailRef.current = detail;

  const loadDetail = useCallback(async () => {
    if (!campaignId) return;
    try {
      setDetail(await communicationsApi.getCampaign(campaignId));
    } catch (e) {
      setError(errorText(e));
    }
  }, [campaignId]);

  const loadRecipients = useCallback(
    async (offset: number) => {
      if (!campaignId) return;
      try {
        const r = await communicationsApi.listRecipients(campaignId, { status: recStatus === "all" ? undefined : recStatus, limit: PAGE, offset });
        setRecipients((prev) => (offset === 0 || !prev ? r.recipients : [...prev, ...r.recipients]));
        setRecOffset(offset);
        setRecMore(r.recipients.length === PAGE);
      } catch (e) {
        setError(errorText(e));
      }
    },
    [campaignId, recStatus],
  );

  // Open / close reset.
  useEffect(() => {
    setDetail(null);
    setRecipients(null);
    setError(null);
    setNotice(null);
    setTestTo("");
    setWhen("");
    setConfirm(null);
    if (campaignId) void loadDetail();
  }, [campaignId, loadDetail]);
  useEffect(() => {
    if (campaignId) void loadRecipients(0);
  }, [campaignId, loadRecipients]);

  // Poll only while something is in flight.
  useEffect(() => {
    if (!campaignId) return;
    const timer = setInterval(() => {
      if (shouldPoll(detailRef.current)) {
        void loadDetail();
        void loadRecipients(0);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [campaignId, loadDetail, loadRecipients]);

  async function run(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await loadDetail();
      await loadRecipients(0);
      onChanged();
    } catch (e) {
      setError(errorText(e));
      await loadDetail();
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const actions = detail ? availableActions(detail) : null;
  const steps = detail ? flowSteps(detail) : [];
  const c = detail?.campaign;
  const scheduleIso = localDateTimeToIso(when);
  const pct = detail && c ? progressPercent(detail.recipientCounts, c.total_recipients) : 0;

  return (
    <Dialog open={campaignId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {c?.name ?? "Campaign"} {c && <StatusBadge status={c.status} />}
          </DialogTitle>
          <DialogDescription>
            {c ? `${c.channel_type} · ${c.total_recipients} recipient(s) · created ${formatDate(c.created_at)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        <ErrorNote message={error} />
        {notice && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}
        {!detail && !error && <LoadingRow />}

        {detail && c && actions && (
          <div className="space-y-6">
            <ol className="grid gap-2 sm:grid-cols-5">
              {steps.map((s) => (
                <StepItem key={s.key} step={s} />
              ))}
            </ol>

            <section className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Progress</span>
                <span className="text-muted-foreground">
                  {detail.recipientCounts.sent} sent · {detail.recipientCounts.failed} failed · {detail.recipientCounts.suppressed} suppressed · {detail.recipientCounts.queued} in flight · {detail.recipientCounts.pending} waiting
                </span>
              </div>
              <Progress value={pct} />
              {c.status === "paused" && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  Paused
                  {c.paused_reason === "quota"
                    ? ": this organization's daily send quota was reached"
                    : c.paused_reason === "unsubscribe_not_configured"
                      ? ": the server has no unsubscribe configuration (COMM_UNSUBSCRIBE_SECRET / COMM_PUBLIC_BASE_URL), so no email was sent"
                      : ""}
                  . Nothing was dropped — fix the cause, then use Execute to resume.
                </p>
              )}
              {!detail.unsubscribeReady && (
                <p role="alert" className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
                  Email campaigns need a signed unsubscribe link. The server has no <code>COMM_UNSUBSCRIBE_SECRET</code> / <code>COMM_PUBLIC_BASE_URL</code>, so this campaign cannot be
                  scheduled or executed.
                </p>
              )}
              {c.audience && (
                <p className="text-xs text-muted-foreground">
                  Audience: {c.audience.type === "contacts" ? "picked contacts" : c.audience.type === "list" ? "a saved list" : "a saved segment"}
                  {c.audience_summary ? ` · ${c.audience_summary.suppressed} suppressed, ${c.audience_summary.invalidAddress} invalid address` : ""}
                </p>
              )}
            </section>

            {/* 3. Send test */}
            <section className="space-y-3 rounded-md border p-4">
              <h3 className="font-medium">3. Send test</h3>
              <p className="text-sm text-muted-foreground">
                Sends one <strong>real</strong> message to an address you choose, through the normal queue and provider. Scheduling and execution stay locked until that
                message actually reaches <em>sent</em>.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1 space-y-1">
                  <Label htmlFor="test-to">{c.channel_type === "email" ? "Test email address" : "Test phone number (+91…)"}</Label>
                  <Input id="test-to" value={testTo} onChange={(e) => setTestTo(e.target.value)} disabled={!actions.canTest} />
                </div>
                <Button
                  disabled={!actions.canTest || testTo.trim() === "" || busy !== null}
                  onClick={() => void run("test", () => communicationsApi.sendTest(c.id, testTo.trim(), newIdempotencyKey()), "Test message queued. It is sent by the worker; this panel updates when it is.")}
                >
                  {busy === "test" ? "Sending…" : "Send test message"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    void loadDetail();
                    // The recipients table only auto-refreshes while polling is active (shouldPoll); once a
                    // campaign finishes, Refresh must still pull the per-recipient error_message rows, or a
                    // completed campaign's failure reasons stay stuck at their pre-completion snapshot.
                    void loadRecipients(0);
                  }}
                  aria-label="Refresh"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              {actions.reasons.test && <p className="text-sm text-muted-foreground">{actions.reasons.test}</p>}
              {detail.lastTest && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Last test to {detail.lastTest.recipient}:</span>
                  <StatusBadge status={detail.lastTest.status} />
                  {detail.lastTest.error_message && <span className="break-words text-red-600 dark:text-red-400">{detail.lastTest.error_message}</span>}
                </div>
              )}
            </section>

            {/* 4. Schedule / 5. Execute */}
            <section className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3 rounded-md border p-4">
                <h3 className="font-medium">4. Schedule</h3>
                <Label htmlFor="when">Start at (your local time)</Label>
                <Input id="when" type="datetime-local" min={minScheduleLocal()} value={when} onChange={(e) => setWhen(e.target.value)} disabled={!actions.canSchedule} />
                <Button
                  disabled={!actions.canSchedule || !scheduleIso || busy !== null}
                  onClick={() => scheduleIso && void run("schedule", () => communicationsApi.schedule(c.id, scheduleIso), "Campaign scheduled.")}
                >
                  {busy === "schedule" ? "Scheduling…" : c.status === "scheduled" ? "Reschedule" : "Schedule campaign"}
                </Button>
                {actions.reasons.schedule && <p className="text-sm text-muted-foreground">{actions.reasons.schedule}</p>}
                <p className="text-xs text-muted-foreground">
                  A scheduled campaign starts when the worker next runs after that time. How often the worker runs depends on the trigger configured in deployment.
                </p>
              </div>
              <div className="space-y-3 rounded-md border p-4">
                <h3 className="font-medium">5. Execute now</h3>
                <p className="text-sm text-muted-foreground">Starts (or resumes) sending to {c.total_recipients} recipient(s) right away, in batches.</p>
                <div className="flex gap-2">
                  <Button disabled={!actions.canExecute || busy !== null} onClick={() => setConfirm("execute")}>
                    Execute campaign
                  </Button>
                  <Button variant="outline" disabled={!actions.canCancel || busy !== null} onClick={() => setConfirm("cancel")}>
                    <Ban className="mr-2 h-4 w-4" /> Cancel campaign
                  </Button>
                </div>
                {actions.reasons.execute && <p className="text-sm text-muted-foreground">{actions.reasons.execute}</p>}
              </div>
            </section>

            {/* Analytics — only once something could have been sent */}
            {c.status !== "draft" && (
              <section className="space-y-3">
                <h3 className="font-medium">Analytics</h3>
                <CampaignAnalyticsPanel campaignId={c.id} refreshKey={detail} />
              </section>
            )}

            {/* Recipients */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium">Recipients</h3>
                <div className="flex items-center gap-2">
                  <Select value={recStatus} onValueChange={setRecStatus}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["all", "pending", "queued", "sent", "failed", "cancelled", "suppressed"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s === "all" ? "All statuses" : s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => onViewLogs(c.id)}>
                    View delivery logs
                  </Button>
                </div>
              </div>
              {recipients === null ? (
                <LoadingRow />
              ) : recipients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recipients in this state.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recipients.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <div className="font-medium">{r.display_name ?? r.recipient}</div>
                          <div className="text-xs text-muted-foreground">{r.recipient}</div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="break-words text-muted-foreground">{r.error_message ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {recMore && (
                <Button variant="outline" size="sm" onClick={() => void loadRecipients(recOffset + PAGE)}>
                  Load more
                </Button>
              )}
            </section>
          </div>
        )}

        {/* Confirmation for the two irreversible actions */}
        <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{confirm === "execute" ? "Send to real recipients?" : "Cancel this campaign?"}</DialogTitle>
              <DialogDescription>
                {confirm === "execute"
                  ? `This queues ${c?.total_recipients ?? 0} real ${c?.channel_type ?? ""} message(s). Messages already handed to a provider cannot be recalled.`
                  : "Recipients that have not been sent yet are cancelled and queued messages are stopped. Messages already sent are not affected. This cannot be undone."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={busy !== null}>
                Go back
              </Button>
              {confirm === "execute" ? (
                <Button disabled={busy !== null} onClick={() => c && void run("execute", () => communicationsApi.execute(c.id), "Execution started. Messages are sent by the worker in batches.")}>
                  {busy === "execute" ? "Starting…" : "Yes, send"}
                </Button>
              ) : (
                <Button variant="destructive" disabled={busy !== null} onClick={() => c && void run("cancel", () => communicationsApi.cancel(c.id), "Campaign cancelled.")}>
                  {busy === "cancel" ? "Cancelling…" : "Cancel campaign"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function StepItem({ step }: { step: FlowStep }) {
  const icon =
    step.state === "done" ? <Check className="h-4 w-4 text-emerald-500" /> : step.state === "current" ? <CircleDot className="h-4 w-4 text-sky-500" /> : step.state === "blocked" ? <Ban className="h-4 w-4 text-amber-500" /> : <Circle className="h-4 w-4 text-muted-foreground" />;
  return (
    <li className="rounded-md border p-2 text-sm" aria-current={step.state === "current" ? "step" : undefined}>
      <div className="flex items-center gap-2 font-medium">
        {icon}
        {step.label}
      </div>
      {step.note && <p className="mt-1 text-xs text-muted-foreground">{step.note}</p>}
    </li>
  );
}
