import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deliveryTrackingNote } from "@/lib/communicationsFlow";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommOrgAnalytics } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow, StatusBadge } from "./shared";

const WINDOWS = [7, 30, 90];

/**
 * Organization-wide analytics. Every figure is a count of real rows in the message log / campaigns /
 * suppressions for the selected window; test sends are excluded. For email and SMS the only outcome known is
 * whether the provider accepted the message — there are no delivery, open or click figures because none exist.
 */
export function AnalyticsTab({ onOpenCampaign }: { onOpenCampaign?: (id: string) => void }) {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<CommOrgAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setD(await communicationsApi.getAnalytics(days));
    } catch (e) {
      setD(null);
      setError(errorText(e));
    }
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);

  const totals = d?.daily.reduce((a, r) => ({ accepted: a.accepted + r.accepted, failed: a.failed + r.failed, total: a.total + r.total }), { accepted: 0, failed: 0, total: 0 });
  const peak = d ? Math.max(1, ...d.daily.map((r) => r.total)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Counts from the message log for the window. Test sends are excluded.</p>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-40" aria-label="Time window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOWS.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  Last {w} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>
      <ErrorNote message={error} />
      {!d && !error && <LoadingRow />}

      {d && totals && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Messages created" value={totals.total} />
            <Metric label="Accepted by a provider" value={totals.accepted} />
            <Metric label="Failed" value={totals.failed} />
          </div>
          <p className="text-xs text-muted-foreground">
            Email / SMS: {deliveryTrackingNote(d.deliveryTracking.email)} WhatsApp: {deliveryTrackingNote(d.deliveryTracking.whatsapp)}
          </p>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Messages per day</CardTitle>
              <CardDescription>Bar length is the day's total; the darker part is accepted, the red part failed.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.daily.length === 0 ? (
                <EmptyState title="No messages in this window" />
              ) : (
                <ol className="space-y-1">
                  {d.daily.map((r) => (
                    <li key={r.day} className="flex items-center gap-3 text-sm">
                      <span className="w-24 shrink-0 text-muted-foreground">{String(r.day).slice(0, 10)}</span>
                      <div className="flex h-4 flex-1 overflow-hidden rounded bg-muted" role="img" aria-label={`${r.total} messages: ${r.accepted} accepted, ${r.failed} failed`}>
                        <div className="bg-emerald-500" style={{ width: `${(r.accepted / peak) * 100}%` }} />
                        <div className="bg-red-500" style={{ width: `${(r.failed / peak) * 100}%` }} />
                        <div className="bg-sky-400/60" style={{ width: `${((r.total - r.accepted - r.failed) / peak) * 100}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right tabular-nums">{r.total}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By channel</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(d.byChannel).length === 0 && <p className="text-sm text-muted-foreground">No messages.</p>}
                {Object.entries(d.byChannel).map(([ch, statuses]) => (
                  <div key={ch} className="space-y-1">
                    <div className="text-sm font-medium">{ch}</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(statuses).map(([st, n]) => (
                        <span key={st} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
                          <StatusBadge status={st} /> <strong>{n}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Audience &amp; suppressions</CardTitle>
                <CardDescription>
                  {d.audience.lists} list(s), {d.audience.segments} segment(s)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {d.suppressions.length === 0 && <p className="text-sm text-muted-foreground">Nothing is suppressed.</p>}
                {d.suppressions.map((s) => (
                  <div key={`${s.channel_type}-${s.reason}`} className="flex justify-between text-sm">
                    <span>
                      {s.channel_type} · {s.reason}
                    </span>
                    <strong>{s.n}</strong>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top failure reasons</CardTitle>
              <CardDescription>The provider's or system's own error text, grouped.</CardDescription>
            </CardHeader>
            <CardContent>
              {d.topFailureReasons.length === 0 ? (
                <p className="text-sm text-muted-foreground">No failures in this window.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {d.topFailureReasons.map((f) => (
                    <li key={f.reason} className="flex justify-between gap-4">
                      <span className="break-words">{f.reason}</span>
                      <strong>{f.n}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              {d.recentCampaigns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No campaigns in this window.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Recipients</TableHead>
                      <TableHead>Sent</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.recentCampaigns.map((c) => (
                      <TableRow key={c.id} className={onOpenCampaign ? "cursor-pointer" : ""} onClick={() => onOpenCampaign?.(c.id)}>
                        <TableCell className="font-medium">
                          {c.name} <span className="text-xs font-normal text-muted-foreground">{c.channel_type}</span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={c.status} />
                        </TableCell>
                        <TableCell>{c.total_recipients}</TableCell>
                        <TableCell>{c.sent_count}</TableCell>
                        <TableCell>{c.failed_count}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
