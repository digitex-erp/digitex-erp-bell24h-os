import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommAttempt, CommCampaign, CommLogRow } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow, StatusBadge } from "./shared";

const PAGE = 50;
const STATUSES = ["queued", "scheduled", "sending", "sent", "delivered", "failed", "cancelled", "dead_letter"];

/**
 * One row per message, read from the communication_logs view (messages + their delivery attempts).
 * These are the real outcomes recorded by the worker and the WhatsApp webhook; nothing is inferred.
 */
export function LogsTab({ focusCampaignId }: { focusCampaignId?: string }) {
  const [rows, setRows] = useState<CommLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [campaign, setCampaign] = useState(focusCampaignId ?? "all");
  const [includeTests, setIncludeTests] = useState(false);
  const [campaigns, setCampaigns] = useState<CommCampaign[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<CommLogRow | null>(null);

  useEffect(() => {
    communicationsApi
      .listCampaigns()
      .then((r) => setCampaigns(r.campaigns))
      .catch(() => setCampaigns([]));
  }, []);
  useEffect(() => {
    if (focusCampaignId) setCampaign(focusCampaignId);
  }, [focusCampaignId]);

  const load = useCallback(
    async (nextOffset: number) => {
      setError(null);
      try {
        const r = await communicationsApi.listLogs({
          channelType: channel === "all" ? undefined : channel,
          status: status === "all" ? undefined : status,
          campaignId: campaign === "all" ? undefined : campaign,
          includeTests,
          limit: PAGE,
          offset: nextOffset,
        });
        setRows((prev) => (nextOffset === 0 || !prev ? r.logs : [...prev, ...r.logs]));
        setOffset(nextOffset);
        setHasMore(r.logs.length === PAGE);
      } catch (e) {
        setRows(null);
        setError(errorText(e));
      }
    },
    [channel, status, campaign, includeTests],
  );
  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logs</CardTitle>
        <CardDescription>Every message with its real delivery outcome. Open a row to see each provider attempt and its error.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Campaign</Label>
            <Select value={campaign} onValueChange={setCampaign}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All messages</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Checkbox id="log-tests" checked={includeTests} onCheckedChange={(v) => setIncludeTests(v === true)} />
            <Label htmlFor="log-tests">Include test sends</Label>
          </div>
          <Button variant="outline" onClick={() => void load(0)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>

        <ErrorNote message={error} />
        {rows === null && !error && <LoadingRow />}
        {rows && rows.length === 0 && <EmptyState title="No messages match" hint="Messages appear here as soon as they are queued." />}
        {rows && rows.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Last provider</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.message_id} className="cursor-pointer" onClick={() => setSelected(r)}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                    <TableCell className="font-medium">
                      {r.recipient}
                      {r.is_test && <span className="ml-2 text-xs text-muted-foreground">(test)</span>}
                    </TableCell>
                    <TableCell>{r.channel_type}</TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>{r.attempts}</TableCell>
                    <TableCell>{r.last_provider ?? "—"}</TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground" title={r.error_message ?? undefined}>
                      {r.error_message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {hasMore && (
              <Button variant="outline" onClick={() => void load(offset + PAGE)}>
                Load more
              </Button>
            )}
          </>
        )}
      </CardContent>
      <AttemptsDialog row={selected} onClose={() => setSelected(null)} />
    </Card>
  );
}

function AttemptsDialog({ row, onClose }: { row: CommLogRow | null; onClose: () => void }) {
  const [attempts, setAttempts] = useState<CommAttempt[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAttempts(null);
    setError(null);
    if (!row) return;
    communicationsApi
      .getAttempts(row.message_id)
      .then((r) => setAttempts(r.attempts))
      .catch((e) => setError(errorText(e)));
  }, [row]);

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Delivery attempts</DialogTitle>
          <DialogDescription>
            {row?.recipient} · <StatusBadge status={row?.status ?? "unknown"} />
          </DialogDescription>
        </DialogHeader>
        <ErrorNote message={error} />
        {row?.error_message && <ErrorNote message={row.error_message} />}
        {attempts === null && !error && <LoadingRow />}
        {attempts && attempts.length === 0 && (
          <EmptyState
            title="No provider was ever called for this message"
            hint="It failed before reaching a provider (for example: no provider is configured for this channel) or it has not been picked up by the worker yet."
          />
        )}
        {attempts && attempts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {attempts.map((a) => (
                <TableRow key={a.attempt_number}>
                  <TableCell>{a.attempt_number}</TableCell>
                  <TableCell>{a.provider}</TableCell>
                  <TableCell>
                    <StatusBadge status={a.status === "success" ? "sent" : a.status} />
                  </TableCell>
                  <TableCell className="break-words text-muted-foreground">{a.error_message ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(a.attempted_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
}
