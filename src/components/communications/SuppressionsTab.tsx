import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import { MAX_SUPPRESSION_BATCH, parseAddressList } from "@/lib/communicationsFlow";
import type { CommChannel, CommSuppression, SuppressionReason } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow, ToneBadge } from "./shared";

const PAGE = 50;
const REASONS: SuppressionReason[] = ["unsubscribed", "bounced", "complained", "manual", "invalid"];
const ALL = "all";

/**
 * The organization's do-not-contact list. Anything on it is refused at campaign creation, at the send API and
 * again by the worker just before a message is handed to a provider. Unsubscribe-link clicks land here
 * automatically. Removing an entry is an ADMIN-only action (the server enforces it) because it re-enables sending.
 */
export function SuppressionsTab() {
  const [rows, setRows] = useState<CommSuppression[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [channel, setChannel] = useState<string>(ALL);
  const [reason, setReason] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [removing, setRemoving] = useState<CommSuppression | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (nextOffset = 0) => {
      setError(null);
      try {
        const r = await communicationsApi.listSuppressions({
          channelType: channel === ALL ? undefined : (channel as CommChannel),
          reason: reason === ALL ? undefined : (reason as SuppressionReason),
          q: q.trim() || undefined,
          limit: PAGE,
          offset: nextOffset,
        });
        setRows(r.suppressions);
        setTotal(r.total);
        setOffset(nextOffset);
      } catch (e) {
        setRows(null);
        setError(errorText(e));
      }
    },
    [channel, reason, q],
  );
  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.removeSuppression(removing.id);
      setNotice(`${removing.address} can be contacted again.`);
      setRemoving(null);
      await load(offset);
    } catch (e) {
      setError(errorText(e));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Suppression list</CardTitle>
          <CardDescription>
            Addresses that must never be contacted: unsubscribes, bounces, complaints and manual entries. Enforced when a campaign is created, on every send, and once more
            by the worker right before delivery.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load(offset)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add addresses
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-36" aria-label="Filter by channel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All channels</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="w-40" aria-label="Filter by reason">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All reasons</SelectItem>
                {REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="sup-q">Search address</Label>
            <Input id="sup-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="part of an email or phone" maxLength={100} />
          </div>
        </div>

        {notice && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}
        <ErrorNote message={error} />
        {rows === null && !error && <LoadingRow />}
        {rows && rows.length === 0 && (
          <EmptyState title="No suppressed addresses" hint="Addresses appear here when someone unsubscribes, or when you add them. Nothing is suppressed by default." />
        )}
        {rows && rows.length > 0 && (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.address}
                      {s.note && <div className="text-xs font-normal text-muted-foreground">{s.note}</div>}
                    </TableCell>
                    <TableCell>{s.channel_type}</TableCell>
                    <TableCell>
                      <ToneBadge tone={s.reason === "complained" || s.reason === "bounced" ? "danger" : s.reason === "unsubscribed" ? "warning" : "neutral"}>{s.reason}</ToneBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{s.source ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(s)} aria-label={`Remove ${s.address} from the suppression list`}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {offset + 1}–{offset + rows.length} of {total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - PAGE))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={offset + rows.length >= total} onClick={() => void load(offset + PAGE)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onDone={(msg) => {
          setNotice(msg);
          void load(0);
        }}
      />

      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Allow contact again?</DialogTitle>
            <DialogDescription>
              {removing?.address} will be able to receive {removing?.channel_type} messages again. Only do this if the person has asked to be contacted or the entry was
              added by mistake. Removing suppressions requires the ADMIN role.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
              Keep suppressed
            </Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
              {busy ? "Removing…" : "Remove from list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function AddDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (message: string) => void }) {
  const [channel, setChannel] = useState<CommChannel>("email");
  const [reason, setReason] = useState<SuppressionReason>("manual");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setText("");
      setNote("");
      setError(null);
      setInvalid([]);
    }
  }, [open]);

  const parsed = parseAddressList(text);

  async function submit() {
    setBusy(true);
    setError(null);
    setInvalid([]);
    try {
      const r = await communicationsApi.addSuppressions({ channelType: channel, addresses: parsed.addresses, reason, note: note.trim() || undefined });
      const msg = `${r.added} added, ${r.alreadySuppressed} already suppressed${r.invalid.length ? `, ${r.invalid.length} invalid` : ""}.`;
      onDone(msg);
      if (r.invalid.length > 0) {
        // Keep the dialog open so the operator sees exactly which entries were rejected.
        setInvalid(r.invalid);
        setText(r.invalid.join("\n"));
      } else {
        onOpenChange(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add to suppression list</DialogTitle>
          <DialogDescription>Paste addresses separated by new lines, commas or spaces. Addresses already suppressed keep their original reason.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as CommChannel)}>
                <SelectTrigger aria-label="Channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={(v) => setReason(v as SuppressionReason)}>
                <SelectTrigger aria-label="Reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-addresses">Addresses</Label>
            <Textarea id="sup-addresses" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={channel === "email" ? "buyer@example.com" : "+919876543210"} />
            <p className="text-xs text-muted-foreground">
              {parsed.addresses.length} distinct address(es)
              {parsed.tooMany && <span className="text-red-600 dark:text-red-400"> — only the first {MAX_SUPPRESSION_BATCH} will be added; submit the rest separately</span>}.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sup-note">Note (optional)</Label>
            <Input id="sup-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          {invalid.length > 0 && (
            <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              {invalid.length} entr{invalid.length === 1 ? "y was" : "ies were"} not valid for {channel} and {invalid.length === 1 ? "was" : "were"} not added. They are left in the box so you can correct them.
            </p>
          )}
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Close
          </Button>
          <Button onClick={() => void submit()} disabled={busy || parsed.addresses.length === 0}>
            {busy ? "Adding…" : `Add ${parsed.addresses.length} address(es)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
