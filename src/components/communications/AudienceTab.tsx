import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import { criteriaFromForm, describeCriteria, emptyCriteriaForm, leadName, type CriteriaForm } from "@/lib/communicationsFlow";
import type { CommChannel, CommLead, CommList, CommListMember, CommSegment, CommSegmentPreview } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow } from "./shared";

/**
 * Contact lists (hand-curated groups) and segments (saved rules evaluated against contacts when a campaign is
 * created). Both are only ever read at campaign creation; nothing here sends anything.
 */
export function AudienceTab() {
  const [lists, setLists] = useState<CommList[] | null>(null);
  const [segments, setSegments] = useState<CommSegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [segOpen, setSegOpen] = useState(false);
  const [managing, setManaging] = useState<CommList | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "list" | "segment"; id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [l, s] = await Promise.all([communicationsApi.listLists(), communicationsApi.listSegments()]);
      setLists(l.lists);
      setSegments(s.segments);
    } catch (e) {
      setLists(null);
      setSegments(null);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const listNames = useMemo(() => Object.fromEntries((lists ?? []).map((l) => [l.id, l.name])), [lists]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      if (deleting.kind === "list") await communicationsApi.deleteList(deleting.id);
      else await communicationsApi.deleteSegment(deleting.id);
      setDeleting(null);
      await load();
    } catch (e) {
      setError(errorText(e));
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Contact lists</CardTitle>
            <CardDescription>Named groups of contacts. Deleting a list removes the grouping only — the contacts themselves are untouched.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh
            </Button>
            <Button onClick={() => setListOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New list
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {lists === null && !error && <LoadingRow />}
          {lists && lists.length === 0 && <EmptyState title="No lists yet" hint="Create a list, then add contacts to it and use it as a campaign audience." />}
          {lists && lists.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-56" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lists.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">
                      {l.name}
                      {l.description && <div className="text-xs font-normal text-muted-foreground">{l.description}</div>}
                    </TableCell>
                    <TableCell>{l.member_count}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(l.created_at)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button variant="outline" size="sm" onClick={() => setManaging(l)} aria-label={`Manage members of ${l.name}`}>
                        <Users className="mr-1 h-3.5 w-3.5" /> Members
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting({ kind: "list", id: l.id, name: l.name })} aria-label={`Delete list ${l.name}`}>
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
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Segments</CardTitle>
            <CardDescription>
              Saved rules such as "company contains steel". A segment is re-evaluated each time a campaign is created from it, so new matching contacts are included.
            </CardDescription>
          </div>
          <Button onClick={() => setSegOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New segment
          </Button>
        </CardHeader>
        <CardContent>
          {segments === null && !error && <LoadingRow />}
          {segments && segments.length === 0 && <EmptyState title="No segments yet" hint="Define a rule, preview how many contacts match, and save it." />}
          {segments && segments.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {segments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{describeCriteria(s.criteria, listNames)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(s.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setDeleting({ kind: "segment", id: s.id, name: s.name })} aria-label={`Delete segment ${s.name}`}>
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

      <NewListDialog
        open={listOpen}
        onOpenChange={setListOpen}
        onCreated={() => {
          setListOpen(false);
          void load();
        }}
      />
      <NewSegmentDialog
        open={segOpen}
        lists={lists ?? []}
        onOpenChange={setSegOpen}
        onCreated={() => {
          setSegOpen(false);
          void load();
        }}
      />
      <MembersDialog list={managing} onClose={() => setManaging(null)} onChanged={() => void load()} />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.kind} “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              {deleting?.kind === "list"
                ? "The list and its membership are removed. Contacts are not deleted. Existing campaigns keep the recipients they already have."
                : "The saved rule is removed. Existing campaigns keep the recipients they already have."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewListDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
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

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.createList({ name: name.trim(), description: description.trim() || undefined });
      onCreated();
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
          <DialogTitle>New contact list</DialogTitle>
          <DialogDescription>You add contacts to it afterwards with “Members”.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="list-name">Name</Label>
            <Input id="list-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="list-desc">Description (optional)</Label>
            <Input id="list-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </div>
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || name.trim() === ""}>
            {busy ? "Creating…" : "Create list"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewSegmentDialog({ open, lists, onOpenChange, onCreated }: { open: boolean; lists: CommList[]; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [form, setForm] = useState<CriteriaForm>(emptyCriteriaForm());
  const [channel, setChannel] = useState<CommChannel>("email");
  const [preview, setPreview] = useState<CommSegmentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setForm(emptyCriteriaForm());
      setPreview(null);
      setError(null);
    }
  }, [open]);

  const criteria = criteriaFromForm(form);
  const set = (patch: Partial<CriteriaForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null); // a preview describes the rule it was run with, not the edited one
  };

  async function runPreview() {
    if (!criteria) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await communicationsApi.previewSegment({ channelType: channel, criteria }));
    } catch (e) {
      setPreview(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!criteria) return;
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.createSegment({ name: name.trim(), criteria });
      onCreated();
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
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>All conditions you fill in must match (AND). Text matches are case-insensitive “contains”; leave a field empty to ignore it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="seg-name">Name</Label>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="seg-company">Company contains</Label>
              <Input id="seg-company" value={form.companyContains} onChange={(e) => set({ companyContains: e.target.value })} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-name-contains">Name contains</Label>
              <Input id="seg-name-contains" value={form.nameContains} onChange={(e) => set({ nameContains: e.target.value })} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-after">Added after</Label>
              <Input id="seg-after" type="date" value={form.createdAfter} onChange={(e) => set({ createdAfter: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-before">Added before</Label>
              <Input id="seg-before" type="date" value={form.createdBefore} onChange={(e) => set({ createdBefore: e.target.value })} />
            </div>
          </div>
          {lists.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">In any of these lists</legend>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                {lists.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.listIds.includes(l.id)}
                      onCheckedChange={(v) => set({ listIds: v === true ? [...form.listIds, l.id] : form.listIds.filter((x) => x !== l.id) })}
                    />
                    {l.name} <span className="text-muted-foreground">({l.member_count})</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-3 rounded-md border p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label>Count matches for</Label>
                <Select value={channel} onValueChange={(v) => { setChannel(v as CommChannel); setPreview(null); }}>
                  <SelectTrigger className="w-36" aria-label="Preview channel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" disabled={!criteria || busy} onClick={() => void runPreview()}>
                {busy ? "Working…" : "Preview matches"}
              </Button>
            </div>
            {!criteria && <p className="text-xs text-muted-foreground">Fill in at least one condition.</p>}
            {preview && (
              <div className="space-y-1 text-sm">
                <p>
                  <strong>{preview.matched}</strong> contact(s) with a usable {channel === "email" ? "email address" : "phone number"} match;{" "}
                  <strong>{preview.suppressed}</strong> of them are suppressed and would be skipped.
                </p>
                {preview.sample.length > 0 && (
                  <p className="text-muted-foreground">
                    e.g. {preview.sample.map((s) => (s.company ? `${s.name} (${s.company})` : s.name)).join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !criteria || name.trim() === ""}>
            Save segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PAGE = 50;

function MembersDialog({ list, onClose, onChanged }: { list: CommList | null; onClose: () => void; onChanged: () => void }) {
  const [members, setMembers] = useState<CommListMember[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<CommChannel>("email");
  const [leads, setLeads] = useState<CommLead[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMembers = useCallback(
    async (next: number) => {
      if (!list) return;
      try {
        const r = await communicationsApi.listMembers(list.id, { limit: PAGE, offset: next });
        setMembers((prev) => (next === 0 || !prev ? r.members : [...prev, ...r.members]));
        setOffset(next);
        setMore(r.members.length === PAGE);
      } catch (e) {
        setMembers([]);
        setError(errorText(e));
      }
    },
    [list],
  );

  useEffect(() => {
    if (!list) return;
    setMembers(null);
    setLeads([]);
    setPick(new Set());
    setQ("");
    setError(null);
    setNotice(null);
    void loadMembers(0);
  }, [list, loadMembers]);

  // Search contacts to add (debounced). List membership is not channel-specific, so unusable addresses may be added too.
  useEffect(() => {
    if (!list || q.trim() === "") {
      setLeads([]);
      return;
    }
    const t = setTimeout(() => {
      communicationsApi
        .listLeads({ channelType: channel, q: q.trim(), limit: 20 })
        .then((r) => setLeads(r.leads))
        .catch((e) => setError(errorText(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [list, q, channel]);

  async function add() {
    if (!list || pick.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await communicationsApi.addMembers(list.id, [...pick]);
      setNotice(`${r.added} added${r.alreadyMembers ? `, ${r.alreadyMembers} already in the list` : ""}${r.notFound ? `, ${r.notFound} not found` : ""}.`);
      setPick(new Set());
      await loadMembers(0);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!list) return;
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.removeMembers(list.id, [id]);
      await loadMembers(0);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={list !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Members of “{list?.name}”</DialogTitle>
          <DialogDescription>Search your contacts to add them. Suppressed addresses can be in a list; they are skipped when a campaign is created.</DialogDescription>
        </DialogHeader>
        <ErrorNote message={error} />
        {notice && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>}

        <section className="space-y-3 rounded-md border p-3">
          <h3 className="text-sm font-medium">Add contacts</h3>
          <div className="flex flex-wrap gap-3">
            <Input className="min-w-56 flex-1" placeholder="Search name, company or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contacts to add" />
            <Select value={channel} onValueChange={(v) => setChannel(v as CommChannel)}>
              <SelectTrigger className="w-40" aria-label="Address shown">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Show email</SelectItem>
                <SelectItem value="sms">Show phone</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {q.trim() !== "" && leads.length === 0 && <p className="text-sm text-muted-foreground">No contacts match.</p>}
          {leads.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {leads.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={pick.has(l.id)}
                    onCheckedChange={(v) =>
                      setPick((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(l.id);
                        else next.delete(l.id);
                        return next;
                      })
                    }
                  />
                  <span className="font-medium">{leadName(l)}</span>
                  <span className="text-muted-foreground">
                    {l.company ?? ""} {(channel === "email" ? l.email : l.phone) ?? ""}
                  </span>
                </label>
              ))}
            </div>
          )}
          <Button size="sm" disabled={busy || pick.size === 0} onClick={() => void add()}>
            Add {pick.size} selected
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Current members</h3>
          {members === null && <LoadingRow />}
          {members && members.length === 0 && <p className="text-sm text-muted-foreground">No members yet.</p>}
          {members && members.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{leadName(m)}</TableCell>
                    <TableCell className="text-muted-foreground">{m.company ?? "—"}</TableCell>
                    <TableCell>{m.email ?? "—"}</TableCell>
                    <TableCell>{m.phone ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(m.id)} aria-label={`Remove ${leadName(m)} from the list`}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {more && (
            <Button variant="outline" size="sm" onClick={() => void loadMembers(offset + PAGE)}>
              Load more
            </Button>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
