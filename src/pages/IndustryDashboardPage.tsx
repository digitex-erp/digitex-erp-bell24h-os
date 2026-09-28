import { useCallback, useEffect, useState } from "react";
import { Lightbulb, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorNote, formatDate, LoadingRow, ToneBadge } from "@/components/communications/shared";
import { errorText } from "@/lib/communicationsApi";
import { industryApi, isTablesMissing } from "@/lib/industryApi";
import { barHeights, directionLabel, signalFormProblem, SIGNAL_TYPES, SOURCE_TYPES, sourceLabel } from "@/lib/industryFlow";
import type { IndustryCategory, IndustryRow, IndustrySignal, IndustrySummary, IndustryTrend, NewSignal, SignalType, SourceType } from "@/types/industry";

const ALL = "all";

/**
 * Industry Intelligence — an organization-scoped register of industries and the market SIGNALS your team records,
 * each with its source. Nothing on this page is fetched from the internet, scraped or predicted: every row is
 * something a person entered (or looked up in a public API / web search and pasted with its URL). "Trends" are simple
 * counts of what was recorded, week by week — not forecasts. Access follows your organization role (server enforced).
 */
export function IndustryDashboardPage() {
  const [overview, setOverview] = useState<{ industries: IndustryRow[]; summary: IndustrySummary } | null>(null);
  const [signals, setSignals] = useState<{ rows: IndustrySignal[]; total: number } | null>(null);
  const [opps, setOpps] = useState<IndustrySignal[] | null>(null);
  const [trends, setTrends] = useState<{ rows: IndustryTrend[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [industryFilter, setIndustryFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [sourceFilter, setSourceFilter] = useState(ALL);
  const [signalOpen, setSignalOpen] = useState(false);
  const [industryOpen, setIndustryOpen] = useState(false);
  const [openIndustry, setOpenIndustry] = useState<IndustryRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "industry" | "signal"; id: string; label: string } | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [o, s, op, tr] = await Promise.all([
        industryApi.overview(),
        industryApi.listSignals({
          industryId: industryFilter === ALL ? undefined : industryFilter,
          signalType: typeFilter === ALL ? undefined : (typeFilter as SignalType),
          sourceType: sourceFilter === ALL ? undefined : (sourceFilter as SourceType),
          limit: 50,
        }),
        industryApi.listOpportunities(),
        industryApi.trends(8),
      ]);
      setOverview(o);
      setSignals({ rows: s.signals, total: s.total });
      setOpps(op.signals);
      setTrends({ rows: tr.trends, note: tr.note });
    } catch (e) {
      setOverview(null);
      setSignals(null);
      setOpps(null);
      setTrends(null);
      setError(errorText(e));
    }
  }, [industryFilter, typeFilter, sourceFilter]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function doDelete() {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.kind === "industry") await industryApi.deleteIndustry(confirmDelete.id);
      else await industryApi.deleteSignal(confirmDelete.id);
      setNotice(`Deleted ${confirmDelete.kind} “${confirmDelete.label}”.`);
      setConfirmDelete(null);
      await loadAll();
    } catch (e) {
      setError(errorText(e));
      setConfirmDelete(null);
    }
  }

  async function toggleOpportunity(s: IndustrySignal) {
    try {
      await industryApi.setOpportunity(s.id, { isRfqOpportunity: !s.is_rfq_opportunity });
      await loadAll();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const tablesMissing = error !== null && isTablesMissing(error);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Industry Intelligence</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            The market signals your team records, with where each came from. Nothing here is fetched, scraped or predicted — every row was entered by a person, or looked up in a
            public API / web search and pasted with its source link. Flag a signal as an <strong>RFQ opportunity</strong> when it suggests a request worth posting.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void loadAll()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={() => setIndustryOpen(true)} disabled={tablesMissing}>
            <Plus className="mr-2 h-4 w-4" /> Industry
          </Button>
          <Button onClick={() => setSignalOpen(true)} disabled={tablesMissing}>
            <Plus className="mr-2 h-4 w-4" /> Record signal
          </Button>
        </div>
      </div>

      {notice && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}

      {tablesMissing ? (
        <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">The industry tables have not been created in this database.</p>
          <p>
            An administrator needs to apply <code>add_industry_intelligence.sql</code> and then <code>add_industry_signals.sql</code>. Until then this page has nothing to show — it
            is not showing an empty organization, it cannot read the tables at all.
          </p>
        </div>
      ) : (
        <ErrorNote message={error} />
      )}

      {!overview && !error && <LoadingRow />}

      {overview && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Industries" value={overview.industries.length} />
            <Metric label="Signals recorded" value={overview.summary.signals} sub={`${overview.summary.signals_30d} in the last 30 days`} />
            <Metric label="RFQ opportunities" value={overview.summary.opportunities} />
            <Metric
              label="By source"
              value={`${overview.summary.user_provided} / ${overview.summary.public_api} / ${overview.summary.web_search}`}
              sub="entered / public API / web search"
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="h-4 w-4" /> RFQ opportunities
              </CardTitle>
              <CardDescription>Signals your team flagged as worth turning into a request. Each keeps its source.</CardDescription>
            </CardHeader>
            <CardContent>
              {opps === null ? (
                <LoadingRow />
              ) : opps.length === 0 ? (
                <EmptyState title="No opportunities flagged" hint="Open a signal below and tick “RFQ opportunity”, or flag it when you record it." />
              ) : (
                <ul className="space-y-3">
                  {opps.map((s) => (
                    <li key={s.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{s.title}</span>
                        {s.industry_name && <ToneBadge tone="info">{s.industry_name}</ToneBadge>}
                        <span className="text-xs text-muted-foreground">{formatDate(s.observed_at)}</span>
                      </div>
                      {s.opportunity_note && <p className="mt-1">{s.opportunity_note}</p>}
                      <SourceLine s={s} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Industries</CardTitle>
              <CardDescription>Your organization's industries. Open one to see and add its categories.</CardDescription>
            </CardHeader>
            <CardContent>
              {overview.industries.length === 0 ? (
                <EmptyState title="No industries yet" hint="Add the industries you track (for example Steel, Packaging). This page starts empty on purpose: nothing is pre-filled." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Industry</TableHead>
                      <TableHead>Categories</TableHead>
                      <TableHead>Personas (buyer / supplier)</TableHead>
                      <TableHead>Signals (30 d / all)</TableHead>
                      <TableHead className="w-40" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.industries.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium">
                          {i.name}
                          {i.description && <div className="text-xs font-normal text-muted-foreground">{i.description}</div>}
                        </TableCell>
                        <TableCell>{i.categories}</TableCell>
                        <TableCell>
                          {i.buyer_personas} / {i.supplier_personas}
                        </TableCell>
                        <TableCell>
                          {i.signals_30d} / {i.signals}
                        </TableCell>
                        <TableCell className="space-x-1 text-right">
                          <Button variant="outline" size="sm" onClick={() => setOpenIndustry(i)} aria-label={`Open ${i.name}`}>
                            Open
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete({ kind: "industry", id: i.id, label: i.name })} aria-label={`Delete industry ${i.name}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Weekly signal counts</CardTitle>
              <CardDescription>{trends?.note ?? "Loading…"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {trends === null ? (
                <LoadingRow />
              ) : trends.rows.length === 0 ? (
                <EmptyState title="Nothing to chart yet" hint="Record signals with an observation date and their weekly counts appear here." />
              ) : (
                trends.rows.map((t) => {
                  const heights = barHeights(t.weekly.map((w) => w.count));
                  const dir = directionLabel(t.direction);
                  return (
                    <div key={t.industryId ?? "unassigned"} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{t.name}</span>
                        <span className="text-muted-foreground">{t.total} in the last {t.weekly.length} weeks</span>
                        <ToneBadge tone={dir.tone}>{dir.text}</ToneBadge>
                      </div>
                      <div className="flex h-12 items-end gap-1" role="img" aria-label={`${t.name}: weekly counts ${t.weekly.map((w) => w.count).join(", ")}`}>
                        {t.weekly.map((w, i) => (
                          <div key={w.weekStart} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`Week of ${w.weekStart}: ${w.count}`}>
                            <div className="w-full rounded-sm bg-primary/70" style={{ height: `${Math.max(heights[i], w.count > 0 ? 6 : 0)}%` }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Signals</CardTitle>
                <CardDescription>{signals ? `${signals.total} match` : "Loading…"}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <FilterSelect label="Industry" value={industryFilter} onChange={setIndustryFilter} options={overview.industries.map((i) => ({ value: i.id, label: i.name }))} />
                <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={SIGNAL_TYPES} />
                <FilterSelect label="Source" value={sourceFilter} onChange={setSourceFilter} options={SOURCE_TYPES.map((s) => ({ value: s.value, label: s.label }))} />
              </div>
            </CardHeader>
            <CardContent>
              {signals === null ? (
                <LoadingRow />
              ) : signals.rows.length === 0 ? (
                <EmptyState title="No signals recorded" hint="Use “Record signal” to add one. Public API and web-search signals need a source URL." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Signal</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Observed</TableHead>
                      <TableHead>RFQ opp.</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {signals.rows.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="max-w-md">
                          <div className="font-medium">{s.title}</div>
                          {s.industry_name && <div className="text-xs text-muted-foreground">{s.industry_name}</div>}
                          {s.summary && <div className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{s.summary}</div>}
                        </TableCell>
                        <TableCell>{s.signal_type}</TableCell>
                        <TableCell>
                          <ToneBadge tone={s.source_type === "user_provided" ? "neutral" : "info"}>{sourceLabel(s.source_type)}</ToneBadge>
                          <SourceLine s={s} compact />
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(s.observed_at)}</TableCell>
                        <TableCell>
                          <Checkbox checked={s.is_rfq_opportunity} onCheckedChange={() => void toggleOpportunity(s)} aria-label={`Flag ${s.title} as an RFQ opportunity`} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete({ kind: "signal", id: s.id, label: s.title })} aria-label={`Delete signal ${s.title}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <SignalDialog
        open={signalOpen}
        industries={overview?.industries ?? []}
        onOpenChange={setSignalOpen}
        onSaved={() => {
          setSignalOpen(false);
          setNotice("Signal recorded.");
          void loadAll();
        }}
      />
      <IndustryDialog
        open={industryOpen}
        onOpenChange={setIndustryOpen}
        onSaved={() => {
          setIndustryOpen(false);
          setNotice("Industry added.");
          void loadAll();
        }}
      />
      <CategoriesDialog industry={openIndustry} onClose={() => setOpenIndustry(null)} onChanged={() => void loadAll()} />

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.kind} “{confirmDelete?.label}”?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.kind === "industry"
                ? "Its categories and personas are removed. Signals recorded against it are kept and become unassigned."
                : "The signal is removed. This cannot be undone. Requires the ADMIN or MANAGER role."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void doDelete()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function SourceLine({ s, compact = false }: { s: IndustrySignal; compact?: boolean }) {
  if (!s.source_name && !s.source_url) return compact ? null : <p className="mt-1 text-xs text-muted-foreground">Source: entered by a person.</p>;
  return (
    <div className="mt-1 text-xs text-muted-foreground">
      {s.source_name && <span>{s.source_name} </span>}
      {s.source_url && (
        <a href={s.source_url} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline">
          {s.source_url}
        </a>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-40" aria-label={`Filter by ${label.toLowerCase()}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}s</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SignalDialog({ open, industries, onOpenChange, onSaved }: { open: boolean; industries: IndustryRow[]; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [f, setF] = useState<NewSignal & { observedAt: string }>({ title: "", signalType: "demand", sourceType: "user_provided", observedAt: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setF({ title: "", signalType: "demand", sourceType: "user_provided", observedAt: "" });
      setError(null);
    }
  }, [open]);
  const set = (p: Partial<NewSignal & { observedAt: string }>) => setF((prev) => ({ ...prev, ...p }));
  const problem = signalFormProblem(f);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await industryApi.createSignal({
        ...f,
        title: f.title.trim(),
        summary: f.summary?.trim() || undefined,
        sourceName: f.sourceName?.trim() || undefined,
        sourceUrl: f.sourceUrl?.trim() || undefined,
        observedAt: f.observedAt ? new Date(f.observedAt).toISOString() : undefined,
        industryId: f.industryId || undefined,
        opportunityNote: f.isRfqOpportunity ? f.opportunityNote?.trim() || undefined : undefined,
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record a signal</DialogTitle>
          <DialogDescription>Write down what you learned and where it came from. This app does not fetch or verify it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sig-title">Title</Label>
            <Input id="sig-title" value={f.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Signal type</Label>
              <Select value={f.signalType} onValueChange={(v) => set({ signalType: v as SignalType })}>
                <SelectTrigger aria-label="Signal type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIGNAL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Industry (optional)</Label>
              <Select value={f.industryId ?? "none"} onValueChange={(v) => set({ industryId: v === "none" ? undefined : v })}>
                <SelectTrigger aria-label="Industry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {industries.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Where did it come from?</Label>
            <Select value={f.sourceType} onValueChange={(v) => set({ sourceType: v as SourceType })}>
              <SelectTrigger aria-label="Source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_TYPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{SOURCE_TYPES.find((s) => s.value === f.sourceType)?.help}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sig-source-name">Source name (optional)</Label>
              <Input id="sig-source-name" value={f.sourceName ?? ""} onChange={(e) => set({ sourceName: e.target.value })} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sig-source-url">Source URL{f.sourceType === "user_provided" ? " (optional)" : ""}</Label>
              <Input id="sig-source-url" value={f.sourceUrl ?? ""} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://" maxLength={500} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sig-date">Observed on (optional, defaults to now)</Label>
            <Input id="sig-date" type="date" value={f.observedAt} onChange={(e) => set({ observedAt: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sig-summary">Details (optional)</Label>
            <Textarea id="sig-summary" rows={3} value={f.summary ?? ""} onChange={(e) => set({ summary: e.target.value })} maxLength={2000} />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <Checkbox className="mt-0.5" checked={!!f.isRfqOpportunity} onCheckedChange={(v) => set({ isRfqOpportunity: v === true })} />
            <span>This suggests an RFQ worth posting (an opportunity)</span>
          </label>
          {f.isRfqOpportunity && (
            <div className="space-y-2">
              <Label htmlFor="sig-opp-note">What request would you post? (optional)</Label>
              <Input id="sig-opp-note" value={f.opportunityNote ?? ""} onChange={(e) => set({ opportunityNote: e.target.value })} maxLength={500} />
            </div>
          )}
          {problem && f.title !== "" && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{problem}</p>}
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || problem !== null}>
            {busy ? "Saving…" : "Record signal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IndustryDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setError(null);
    }
  }, [open]);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await industryApi.createIndustry({ name: name.trim(), description: description.trim() || undefined });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an industry</DialogTitle>
          <DialogDescription>Names are unique within your organization (not across organizations).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ind-name">Name</Label>
            <Input id="ind-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ind-desc">Description (optional)</Label>
            <Textarea id="ind-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </div>
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || name.trim() === ""}>
            {busy ? "Adding…" : "Add industry"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CategoriesDialog({ industry, onClose, onChanged }: { industry: IndustryRow | null; onClose: () => void; onChanged: () => void }) {
  const [cats, setCats] = useState<IndustryCategory[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!industry) return;
    try {
      setCats((await industryApi.listCategories(industry.id)).categories);
    } catch (e) {
      setCats([]);
      setError(errorText(e));
    }
  }, [industry]);
  useEffect(() => {
    setCats(null);
    setName("");
    setError(null);
    void load();
  }, [load]);
  async function add() {
    if (!industry) return;
    setError(null);
    try {
      await industryApi.createCategory(industry.id, { name: name.trim() });
      setName("");
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <Dialog open={industry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{industry?.name} — categories</DialogTitle>
          <DialogDescription>Categories group what this industry buys and sells.</DialogDescription>
        </DialogHeader>
        <ErrorNote message={error} />
        {cats === null ? (
          <LoadingRow />
        ) : cats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No categories yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {cats.map((c) => (
              <li key={c.id} className="rounded border px-3 py-1.5">
                {c.name}
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" aria-label="New category name" maxLength={120} />
          <Button onClick={() => void add()} disabled={name.trim() === ""}>
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
