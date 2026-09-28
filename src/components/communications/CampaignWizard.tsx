import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addressFor, leadName } from "@/lib/communicationsFlow";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommAudienceSummary, CommChannel, CommLead, CommTemplate } from "@/types/communications";
import { EmptyState, ErrorNote, LoadingRow, ToneBadge } from "./shared";

const PAGE = 50;

/**
 * Steps 1-2 of the flow: SELECT LEADS -> CREATE CAMPAIGN (a draft; nothing is sent).
 * Sending starts only from the campaign's own panel (test -> schedule / execute), each gated by the server.
 */
export function CampaignWizard({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (campaignId: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [channel, setChannel] = useState<CommChannel>("email");
  const [templates, setTemplates] = useState<CommTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [q, setQ] = useState("");
  const [leads, setLeads] = useState<CommLead[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; audience: CommAudienceSummary } | null>(null);

  const reset = useCallback(() => {
    setStep(1);
    setTemplateId("");
    setQ("");
    setSelected(new Set());
    setName("");
    setConsent(false);
    setError(null);
    setResult(null);
  }, []);
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  // Templates for the chosen channel.
  useEffect(() => {
    if (!open) return;
    setTemplateId("");
    communicationsApi
      .listTemplates(channel)
      .then((r) => setTemplates(r.templates.filter((t) => t.is_active)))
      .catch((e) => {
        setTemplates([]);
        setError(errorText(e));
      });
  }, [open, channel]);

  // Leads for the chosen channel / search (debounced). Selection is per channel: switching clears it.
  const loadLeads = useCallback(
    async (nextOffset: number) => {
      setLoadingLeads(true);
      try {
        const r = await communicationsApi.listLeads({ channelType: channel, q: q.trim() || undefined, limit: PAGE, offset: nextOffset });
        setLeads((prev) => (nextOffset === 0 ? r.leads : [...prev, ...r.leads]));
        setOffset(nextOffset);
        setHasMore(r.leads.length === PAGE);
      } catch (e) {
        setLeads([]);
        setError(errorText(e));
      } finally {
        setLoadingLeads(false);
      }
    },
    [channel, q],
  );
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void loadLeads(0), 300);
    return () => clearTimeout(t);
  }, [open, loadLeads]);
  useEffect(() => {
    setSelected(new Set());
  }, [channel]);

  const usable = useMemo(() => leads.filter((l) => l.usable), [leads]);
  const allShownSelected = usable.length > 0 && usable.every((l) => selected.has(l.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await communicationsApi.createCampaign({ name, channelType: channel, templateId, contactIds: [...selected], consentConfirmed: consent });
      setResult({ id: r.campaign.id, audience: r.audience });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const skipped = result ? result.audience.requested - result.audience.resolved : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{result ? "Campaign created" : step === 1 ? "New campaign — 1. Select leads" : "New campaign — 2. Create"}</DialogTitle>
          <DialogDescription>
            {result
              ? "The campaign is a draft. Nothing has been sent."
              : "Leads are your organization's contacts. Only contacts with a valid address for the channel can be selected."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Selected" value={result.audience.requested} />
              <Stat label="In campaign" value={result.audience.resolved} />
              <Stat label="Invalid address" value={result.audience.invalidAddress} />
              <Stat label="Duplicates / missing" value={result.audience.duplicate + result.audience.notFound} />
            </div>
            {skipped > 0 && <p className="text-sm text-muted-foreground">{skipped} selected lead(s) were left out (see counts above).</p>}
            <p className="text-sm text-muted-foreground">Next: send a test message, wait until it is sent, then schedule or execute.</p>
            <DialogFooter>
              <Button onClick={() => onCreated(result.id)}>Open campaign</Button>
            </DialogFooter>
          </div>
        ) : step === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as CommChannel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={templates.length ? "Choose a template" : "No active templates for this channel"} />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search name, company or email" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>

            <ErrorNote message={error} />
            {loadingLeads && leads.length === 0 && <LoadingRow label="Loading leads…" />}
            {!loadingLeads && leads.length === 0 && (
              <EmptyState title="No leads with a usable address" hint={`Contacts need a valid ${channel === "email" ? "email address" : "phone number in international format (+91…)"}.`} />
            )}
            {leads.length > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={allShownSelected}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const l of usable) {
                            if (v === true) next.add(l.id);
                            else next.delete(l.id);
                          }
                          return next;
                        })
                      }
                    />
                    Select all shown ({usable.length})
                  </label>
                  <span className="text-muted-foreground">{selected.size} selected</span>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Lead</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>{channel === "email" ? "Email" : "Phone"}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map((l) => (
                        <TableRow key={l.id} className={l.usable ? "" : "opacity-60"}>
                          <TableCell>
                            <Checkbox checked={selected.has(l.id)} disabled={!l.usable} onCheckedChange={(v) => toggle(l.id, v === true)} aria-label={`Select ${leadName(l)}`} />
                          </TableCell>
                          <TableCell className="font-medium">{leadName(l)}</TableCell>
                          <TableCell className="text-muted-foreground">{l.company ?? "—"}</TableCell>
                          <TableCell>
                            {addressFor(channel, l)}
                            {!l.usable && <ToneBadge tone="danger" className="ml-2">invalid</ToneBadge>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {hasMore && (
                  <Button variant="outline" size="sm" disabled={loadingLeads} onClick={() => void loadLeads(offset + PAGE)}>
                    {loadingLeads ? "Loading…" : "Load more"}
                  </Button>
                )}
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={selected.size === 0 || !templateId} onClick={() => setStep(2)}>
                Continue with {selected.size} lead(s)
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="camp-name">Campaign name</Label>
              <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            </div>
            <div className="rounded-md border p-3 text-sm">
              <p>
                <strong>{selected.size}</strong> {channel} recipient(s) · template <strong>{templates.find((t) => t.id === templateId)?.name}</strong>
              </p>
            </div>
            <label className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <Checkbox className="mt-0.5" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
              <span>
                I confirm every selected recipient has opted in to receive this message, or that there is another lawful basis to contact them. (Contacts carry no
                consent record, so this attestation is stored with the campaign.)
              </span>
            </label>
            <ErrorNote message={error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)} disabled={busy}>
                Back
              </Button>
              <Button disabled={busy || name.trim() === "" || !consent} onClick={() => void create()}>
                {busy ? "Creating…" : "Create draft campaign"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
