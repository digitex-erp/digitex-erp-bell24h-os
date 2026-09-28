import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addressFor, describeCriteria, leadName, templateHasUnsubscribe, whatsappTemplateUsable } from "@/lib/communicationsFlow";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommAudienceSummary, CommChannel, CommLead, CommList, CommSegment, CommSegmentPreview, CommTemplate } from "@/types/communications";
import { EmptyState, ErrorNote, LoadingRow, ToneBadge } from "./shared";

const PAGE = 50;

type AudienceSource = "contacts" | "list" | "segment";

/**
 * Steps 1-2 of the flow: SELECT LEADS -> CREATE CAMPAIGN (a draft; nothing is sent).
 * The audience is exactly ONE of: hand-picked contacts, a saved list, or a saved segment (re-evaluated when the
 * campaign is created). Addresses on the suppression list are left out by the server.
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
  const [source, setSource] = useState<AudienceSource>("contacts");
  const [lists, setLists] = useState<CommList[]>([]);
  const [segments, setSegments] = useState<CommSegment[]>([]);
  const [listId, setListId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [preview, setPreview] = useState<CommSegmentPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
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
    setSource("contacts");
    setListId("");
    setSegmentId("");
    setPreview(null);
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

  // Saved audiences (lists and segments) for the "from a list / segment" sources.
  useEffect(() => {
    if (!open) return;
    communicationsApi.listLists().then((r) => setLists(r.lists)).catch(() => setLists([]));
    communicationsApi.listSegments().then((r) => setSegments(r.segments)).catch(() => setSegments([]));
  }, [open]);

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
    if (!open || source !== "contacts") return;
    const t = setTimeout(() => void loadLeads(0), 300);
    return () => clearTimeout(t);
  }, [open, source, loadLeads]);
  useEffect(() => {
    setSelected(new Set());
    setPreview(null);
  }, [channel]);

  const usable = useMemo(() => leads.filter((l) => l.usable), [leads]);
  const allShownSelected = usable.length > 0 && usable.every((l) => selected.has(l.id));
  const template = templates.find((t) => t.id === templateId);
  const missingUnsubscribe = channel === "email" && template !== undefined && !templateHasUnsubscribe(template.body);
  const missingMetaMapping = channel === "whatsapp" && template !== undefined && !whatsappTemplateUsable(template);
  const chosenList = lists.find((l) => l.id === listId);
  const chosenSegment = segments.find((s) => s.id === segmentId);
  const listNames = useMemo(() => Object.fromEntries(lists.map((l) => [l.id, l.name])), [lists]);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function runPreview() {
    if (!chosenSegment) return;
    setPreviewing(true);
    setError(null);
    try {
      setPreview(await communicationsApi.previewSegment({ channelType: channel, criteria: chosenSegment.criteria }));
    } catch (e) {
      setPreview(null);
      setError(errorText(e));
    } finally {
      setPreviewing(false);
    }
  }

  const audienceReady =
    source === "contacts" ? selected.size > 0 : source === "list" ? !!chosenList && chosenList.member_count > 0 : !!chosenSegment && (preview === null || preview.matched > 0);

  const audienceLabel =
    source === "contacts"
      ? `${selected.size} selected contact(s)`
      : source === "list"
        ? `list "${chosenList?.name}"`
        : `segment "${chosenSegment?.name}"${preview ? ` (${preview.matched} match now)` : ""}`;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const base = { name, channelType: channel, templateId, consentConfirmed: consent };
      const r = await communicationsApi.createCampaign(
        source === "contacts" ? { ...base, contactIds: [...selected] } : source === "list" ? { ...base, listId } : { ...base, segmentId },
      );
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
              : "Leads are your organization's contacts. Only contacts with a valid address for the channel — and not on the suppression list — receive anything."}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
              <Stat label="Selected" value={result.audience.requested} />
              <Stat label="In campaign" value={result.audience.resolved} />
              <Stat label="Suppressed" value={result.audience.suppressed} />
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
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={channel} onValueChange={(v) => setChannel(v as CommChannel)}>
                  <SelectTrigger aria-label="Channel">
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
                  <SelectTrigger aria-label="Template">
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
              <div className="space-y-2">
                <Label>Audience from</Label>
                <Select value={source} onValueChange={(v) => setSource(v as AudienceSource)}>
                  <SelectTrigger aria-label="Audience source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contacts">Picked contacts</SelectItem>
                    <SelectItem value="list">A saved list</SelectItem>
                    <SelectItem value="segment">A saved segment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {missingUnsubscribe && (
              <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                This email template has no <code>{"{{unsubscribe_url}}"}</code> placeholder. Campaign emails must include an unsubscribe link, so the server will refuse
                this campaign. Add the placeholder in the Templates tab first.
              </p>
            )}

            {missingMetaMapping && (
              <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                This WhatsApp template is not mapped to a Meta-approved template. Campaigns reach contacts outside Meta's 24-hour window, where only an approved template can be
                delivered, so the server will refuse it. Add the Meta template name and its variables in the Templates tab first.
              </p>
            )}
            {channel === "whatsapp" && template !== undefined && !missingMetaMapping && template.provider_template_status !== "verified_by_send" && (
              <p className="rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-700 dark:text-sky-300">
                The Meta template <code>{template.provider_template_name}</code> is <strong>UNVERIFIED</strong>: nothing confirms Meta approved it until a real message using it has been
                accepted. The campaign's test message is that proof — it must succeed before you can schedule or execute.
              </p>
            )}

            <ErrorNote message={error} />

            {source === "list" && (
              <div className="space-y-2">
                <Label>List</Label>
                <Select value={listId} onValueChange={setListId}>
                  <SelectTrigger aria-label="List">
                    <SelectValue placeholder={lists.length ? "Choose a list" : "No lists yet — create one in the Audience tab"} />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({l.member_count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosenList && chosenList.member_count === 0 && <p className="text-sm text-muted-foreground">This list has no members.</p>}
                <p className="text-xs text-muted-foreground">Members without a valid {channel === "email" ? "email address" : "phone number"} are skipped and counted.</p>
              </div>
            )}

            {source === "segment" && (
              <div className="space-y-2">
                <Label>Segment</Label>
                <Select
                  value={segmentId}
                  onValueChange={(v) => {
                    setSegmentId(v);
                    setPreview(null);
                  }}
                >
                  <SelectTrigger aria-label="Segment">
                    <SelectValue placeholder={segments.length ? "Choose a segment" : "No segments yet — create one in the Audience tab"} />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosenSegment && <p className="text-xs text-muted-foreground">{describeCriteria(chosenSegment.criteria, listNames)}</p>}
                {chosenSegment && (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <Button variant="outline" size="sm" disabled={previewing} onClick={() => void runPreview()}>
                      {previewing ? "Counting…" : "Preview who matches"}
                    </Button>
                    {preview && (
                      <span>
                        <strong>{preview.matched}</strong> match now, <strong>{preview.suppressed}</strong> of them suppressed and will be skipped
                        {preview.matched === 0 && " — nothing to send"}.
                      </span>
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">The segment is evaluated again when the campaign is created, so the final count can differ.</p>
              </div>
            )}

            {source === "contacts" && (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Search name, company or email" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
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
                                {!l.usable && (
                                  <ToneBadge tone="danger" className="ml-2">
                                    invalid
                                  </ToneBadge>
                                )}
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
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!audienceReady || !templateId || missingUnsubscribe || missingMetaMapping} onClick={() => setStep(2)}>
                {source === "contacts" ? `Continue with ${selected.size} lead(s)` : "Continue"}
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
                <strong>{audienceLabel}</strong> · {channel} · template <strong>{template?.name}</strong>
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
