import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Phone, Loader2, AlertTriangle, Users, FileText, Eye } from "lucide-react";
import { authedFetchJson } from "@/lib/authedFetch";
import { diagnosticError } from "@/lib/diagnosticsErrors";

// Shogo Voice Studio migration — Batch 1 (overview/calls/agents) + the Call
// Scripts batch (this tab). The remaining ~13 Shogo sub-areas (provider/
// voice/number config, escalation center, automation rules, policies,
// analytics, architecture diagram, receptionist, live monitor) are NOT
// implemented — see docs/audits/SHOGO_VOICE_STUDIO_MIGRATION_REPORT.md and
// docs/audits/SHOGO_CALL_SCRIPTS_IMPLEMENTATION_REPORT.md.

const SCRIPT_SECTIONS: { key: keyof ScriptDraft; label: string }[] = [
  { key: "opening", label: "Opening" },
  { key: "verification", label: "Identity verification" },
  { key: "purpose", label: "Purpose" },
  { key: "questions", label: "Questions" },
  { key: "objections", label: "Objection handling" },
  { key: "negotiation", label: "Negotiation rules" },
  { key: "closing", label: "Closing" },
  { key: "escalation", label: "Escalation" },
  { key: "fallback", label: "Fallback" },
];

const ALLOWED_SCRIPT_VARIABLES = [
  "buyer_name",
  "supplier_name",
  "rfq_number",
  "product",
  "quantity",
  "target_date",
  "price",
  "agent_name",
  "company_name",
];

interface ScriptSummary {
  id: string;
  code: string;
  name: string;
  status: "draft" | "published" | "archived";
  version: number;
  updated_at: string;
}

interface ScriptVersionEntry {
  id: string;
  version: number;
  published_by: string | null;
  published_at: string;
}

interface ScriptDetail extends ScriptSummary {
  agent_key: string | null;
  language: string;
  tone: string;
  opening: string | null;
  verification: string | null;
  purpose: string | null;
  questions: string | null;
  objections: string | null;
  negotiation: string | null;
  closing: string | null;
  escalation: string | null;
  fallback: string | null;
  variables: string[];
  versions: ScriptVersionEntry[];
}

/**
 * POST /api/voice/scripts and PATCH /api/voice/scripts/:code both return the
 * raw voice_scripts row (via VoiceService.createScript/updateScript) -- NOT
 * the ScriptDetail shape GET /:code returns, which additionally joins
 * `versions`. Typing the mutation response as ScriptDetail (as this file
 * originally did) let `scriptDetail.versions.length` compile but throw at
 * runtime on every create/edit, since the mutation response has no
 * `versions` key at all. This narrower type exists so that mistake can't
 * silently recur.
 */
type ScriptMutationResponse = Omit<ScriptDetail, "versions">;

interface ScriptDraft {
  code: string;
  name: string;
  language: string;
  tone: string;
  variables: string[];
  opening: string;
  verification: string;
  purpose: string;
  questions: string;
  objections: string;
  negotiation: string;
  closing: string;
  escalation: string;
  fallback: string;
}

function emptyScriptDraft(): ScriptDraft {
  return {
    code: "",
    name: "",
    language: "en-IN",
    tone: "professional",
    variables: [],
    opening: "",
    verification: "",
    purpose: "",
    questions: "",
    objections: "",
    negotiation: "",
    closing: "",
    escalation: "",
    fallback: "",
  };
}

function detailToDraft(d: ScriptDetail): ScriptDraft {
  return {
    code: d.code,
    name: d.name,
    language: d.language,
    tone: d.tone,
    variables: d.variables ?? [],
    opening: d.opening ?? "",
    verification: d.verification ?? "",
    purpose: d.purpose ?? "",
    questions: d.questions ?? "",
    objections: d.objections ?? "",
    negotiation: d.negotiation ?? "",
    closing: d.closing ?? "",
    escalation: d.escalation ?? "",
    fallback: d.fallback ?? "",
  };
}

/**
 * The server HTML-escapes substituted preview values before returning them
 * (the right call for an API response any client might consume). This React
 * page renders text via JSX, which already escapes on insertion into the
 * DOM -- rendering the server's pre-escaped string directly would double-
 * escape it (an apostrophe would show as the literal text "&#39;"). This
 * reverses that one escaping pass so the already-DOM-safe JSX render shows
 * the real character, not its entity.
 */
function unescapeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

interface ScriptHttpLikeError extends Error {
  status: number;
}
function isScriptHttpError(e: unknown): e is ScriptHttpLikeError {
  return e instanceof Error && typeof (e as { status?: unknown }).status === "number";
}

/**
 * authedFetchJson only forwards the server's `error` code, not `field`/
 * `detail` -- a pre-existing limitation of the shared client, not special-
 * cased around here (reusing the existing client as-is was the brief).
 * Validation failures therefore surface as a code like "validation_failed"
 * rather than a per-field message.
 */
function describeScriptError(e: unknown): string {
  if (isScriptHttpError(e)) {
    const { status } = e;
    if (status === 401) return "Not signed in — sign in and try again.";
    if (status === 403) return "You don't have permission for this action.";
    if (status === 404) return "Script not found.";
    return e.message || `Request failed (${status})`;
  }
  return e instanceof Error ? e.message : "Unexpected error.";
}

interface VoiceCall {
  id: string;
  ref: string;
  contact_name: string;
  company: string | null;
  driver: "simulated" | "dograh";
  status: string;
  outcome: string | null;
  price: number | null;
  currency: string | null;
  created_at: string;
}

interface VoiceAgent {
  id: string;
  agent_key: string;
  name: string;
  purpose: string;
  status: string;
}

type TabKey = "overview" | "calls" | "agents" | "scripts";

export function VoiceStudioPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [calls, setCalls] = useState<VoiceCall[] | null>(null);
  const [agents, setAgents] = useState<VoiceAgent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<any>(null);

  const [form, setForm] = useState({ contactName: "", company: "", objective: "", driver: "simulated" as "simulated" | "dograh" });

  // ── Call Scripts tab state ────────────────────────────────────────────
  const [scripts, setScripts] = useState<ScriptSummary[] | null>(null);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState<string | null>(null);

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [isNewScript, setIsNewScript] = useState(false);
  const [scriptDetail, setScriptDetail] = useState<ScriptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [draft, setDraft] = useState<ScriptDraft>(emptyScriptDraft());
  const [savedSnapshot, setSavedSnapshot] = useState<ScriptDraft | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [duplicateCode, setDuplicateCode] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewResult, setPreviewResult] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Tracks which script code the editor is "currently for," independent of
  // React state timing, so a slow response from an earlier openScript() call
  // can never clobber the editor after the user has since opened a
  // different script, started a new one, or closed the editor. Plain state
  // can't do this reliably inside an async callback (it closes over a
  // snapshot from render time); a ref always reads the latest value.
  const activeScriptCodeRef = useRef<string | null>(null);

  const isScriptEditorOpen = isNewScript || selectedCode !== null;
  const scriptIsDirty = JSON.stringify(draft) !== JSON.stringify(savedSnapshot ?? emptyScriptDraft());
  const isArchivedScript = !isNewScript && scriptDetail?.status === "archived";

  async function loadScripts() {
    setScriptsLoading(true);
    setScriptsError(null);
    try {
      const res = await authedFetchJson<{ scripts: ScriptSummary[] }>("/api/voice/scripts");
      setScripts(res.scripts);
    } catch (e) {
      setScriptsError(describeScriptError(e));
    } finally {
      setScriptsLoading(false);
      setScriptsLoaded(true);
    }
  }

  useEffect(() => {
    if (tab === "scripts" && !scriptsLoaded) {
      loadScripts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function resetScriptEditorFeedback() {
    setDetailError(null);
    setSaveError(null);
    setSaveMessage(null);
    setDuplicateError(null);
    setPublishError(null);
    setPreviewResult(null);
    setPreviewError(null);
    setPreviewValues({});
  }

  /**
   * Fetches the full ScriptDetail (including version history) and applies
   * it, unless a newer navigation has since made `code` stale. Shared by
   * openScript (the user-visible "open" flow) and by saveScript's refresh
   * step after a create/update, so both end up with the same full,
   * consistent shape -- never the narrower create/update response.
   */
  async function refreshScriptDetail(code: string): Promise<boolean> {
    try {
      const res = await authedFetchJson<ScriptDetail>(`/api/voice/scripts/${encodeURIComponent(code)}`);
      if (activeScriptCodeRef.current !== code) return false; // superseded by a later navigation
      setScriptDetail(res);
      const d = detailToDraft(res);
      setDraft(d);
      setSavedSnapshot(d);
      return true;
    } catch (e) {
      if (activeScriptCodeRef.current !== code) return false;
      setDetailError(describeScriptError(e));
      return false;
    }
  }

  async function openScript(code: string) {
    setIsNewScript(false);
    setSelectedCode(code);
    setScriptDetail(null);
    resetScriptEditorFeedback();
    setDetailLoading(true);
    activeScriptCodeRef.current = code;
    await refreshScriptDetail(code);
    if (activeScriptCodeRef.current === code) setDetailLoading(false);
  }

  function startNewScript() {
    activeScriptCodeRef.current = null;
    setIsNewScript(true);
    setSelectedCode(null);
    setScriptDetail(null);
    resetScriptEditorFeedback();
    setDraft(emptyScriptDraft());
    setSavedSnapshot(null);
  }

  function closeScriptEditor() {
    activeScriptCodeRef.current = null;
    setSelectedCode(null);
    setIsNewScript(false);
    setScriptDetail(null);
    setDraft(emptyScriptDraft());
    setSavedSnapshot(null);
    resetScriptEditorFeedback();
  }

  function discardScriptChanges() {
    setDraft(isNewScript ? emptyScriptDraft() : savedSnapshot ?? emptyScriptDraft());
    setSaveError(null);
  }

  function setDraftField<K extends keyof ScriptDraft>(key: K, value: ScriptDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function toggleScriptVariable(name: string) {
    setDraft((d) => ({
      ...d,
      variables: d.variables.includes(name) ? d.variables.filter((v) => v !== name) : [...d.variables, name],
    }));
  }

  function sectionBody(d: ScriptDraft) {
    return {
      opening: d.opening || null,
      verification: d.verification || null,
      purpose: d.purpose || null,
      questions: d.questions || null,
      objections: d.objections || null,
      negotiation: d.negotiation || null,
      closing: d.closing || null,
      escalation: d.escalation || null,
      fallback: d.fallback || null,
    };
  }

  async function saveScript() {
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    try {
      if (isNewScript) {
        // POST returns the raw created row -- NOT the ScriptDetail shape
        // (no `versions`). Typed narrowly so that's enforced at compile
        // time, then immediately re-fetched via GET for the full shape the
        // rest of this panel (version history) actually needs.
        const res = await authedFetchJson<ScriptMutationResponse>("/api/voice/scripts", {
          method: "POST",
          body: JSON.stringify({
            code: draft.code.trim(),
            name: draft.name.trim(),
            language: draft.language,
            tone: draft.tone,
            variables: draft.variables,
            ...sectionBody(draft),
          }),
        });
        setIsNewScript(false);
        setSelectedCode(res.code);
        activeScriptCodeRef.current = res.code;
        await refreshScriptDetail(res.code);
        setSaveMessage(`Script "${res.code}" created as a draft.`);
        setScriptsLoaded(false);
        await loadScripts();
      } else if (selectedCode) {
        const wasPublished = scriptDetail?.status === "published";
        // Same reasoning as above: PATCH's response also lacks `versions`.
        const res = await authedFetchJson<ScriptMutationResponse>(`/api/voice/scripts/${encodeURIComponent(selectedCode)}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: draft.name.trim(),
            language: draft.language,
            tone: draft.tone,
            variables: draft.variables,
            ...sectionBody(draft),
          }),
        });
        await refreshScriptDetail(selectedCode);
        setSaveMessage(
          wasPublished && res.status === "draft"
            ? "Saved. This script reverted to draft because its published content changed."
            : "Saved.",
        );
        setScriptsLoaded(false);
        await loadScripts();
      }
    } catch (e) {
      setSaveError(describeScriptError(e));
    } finally {
      setSaving(false);
    }
  }

  async function submitDuplicateScript() {
    if (!selectedCode || !duplicateCode.trim()) return;
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const res = await authedFetchJson<ScriptMutationResponse>(`/api/voice/scripts/${encodeURIComponent(selectedCode)}/duplicate`, {
        method: "POST",
        body: JSON.stringify({ newCode: duplicateCode.trim() }),
      });
      setDuplicateCode("");
      setScriptsLoaded(false);
      await loadScripts();
      await openScript(res.code);
      setSaveMessage(`Duplicated as a new draft: "${res.code}".`);
    } catch (e) {
      setDuplicateError(describeScriptError(e));
    } finally {
      setDuplicating(false);
    }
  }

  async function submitPublishScript() {
    if (!selectedCode) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await authedFetchJson<{ published: boolean; version: number }>(
        `/api/voice/scripts/${encodeURIComponent(selectedCode)}/publish`,
        { method: "POST" },
      );
      await openScript(selectedCode);
      setSaveMessage(res.published ? `Published as version ${res.version}.` : "Already published at the latest version.");
    } catch (e) {
      setPublishError(describeScriptError(e));
    } finally {
      setPublishing(false);
    }
  }

  async function runScriptPreview() {
    if (!selectedCode) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await authedFetchJson<any>(`/api/voice/scripts/${encodeURIComponent(selectedCode)}/preview`, {
        method: "POST",
        body: JSON.stringify({ sampleValues: previewValues }),
      });
      setPreviewResult(res);
    } catch (e) {
      setPreviewError(describeScriptError(e));
      setPreviewResult(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [callsRes, agentsRes] = await Promise.all([
        authedFetchJson<{ calls: VoiceCall[] }>("/api/voice/calls?limit=25"),
        authedFetchJson<{ agents: VoiceAgent[] }>("/api/voice/agents"),
      ]);
      setCalls(callsRes.calls);
      setAgents(agentsRes.agents);
    } catch (e) {
      const o = diagnosticError(e);
      setError(o.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function dispatchCall() {
    if (!form.contactName.trim() || !form.objective.trim()) {
      setDispatchResult({ error: "Contact name and objective are required." });
      return;
    }
    setDispatching(true);
    setDispatchResult(null);
    try {
      const ref = `VT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const result = await authedFetchJson<any>("/api/voice/calls/dispatch", {
        method: "POST",
        body: JSON.stringify({
          ref,
          contactName: form.contactName.trim(),
          company: form.company.trim() || null,
          objective: form.objective.trim(),
          driver: form.driver,
        }),
      });
      setDispatchResult(result);
      await loadAll();
    } catch (e) {
      const o = diagnosticError(e);
      setDispatchResult({ error: o.message });
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Phone className="h-6 w-6" /> Voice Studio
          </h1>
          <p className="text-sm text-muted-foreground">
            Migrated from Shogo (Batch 1). Simulated calls run offline and are always labelled below; Dograh calls require
            server-side configuration and never fall back to simulation silently.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === "overview" ? "default" : "outline"} onClick={() => setTab("overview")}>Overview</Button>
          <Button variant={tab === "calls" ? "default" : "outline"} onClick={() => setTab("calls")}>Calls</Button>
          <Button variant={tab === "agents" ? "default" : "outline"} onClick={() => setTab("agents")}>Agents</Button>
          <Button variant={tab === "scripts" ? "default" : "outline"} onClick={() => setTab("scripts")}>Scripts</Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-4 text-destructive">
            <AlertTriangle className="h-4 w-4" /> {error}
            <Button size="sm" variant="outline" onClick={loadAll} className="ml-auto">Retry</Button>
          </CardContent>
        </Card>
      )}

      {loading && !error && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading Voice Studio…
        </div>
      )}

      {!loading && !error && tab === "overview" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Dispatch a call</CardTitle>
              <CardDescription>
                Driver "simulated" runs entirely offline and returns an inline result. Driver "dograh" requires
                DOGRAH_BASE_URL/DOGRAH_AGENT_ID server-side and returns a real error if unconfigured — it never silently simulates instead.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              <Input placeholder="Company (optional)" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <Input placeholder="Objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} />
              <div className="flex gap-2">
                <Button variant={form.driver === "simulated" ? "default" : "outline"} size="sm" onClick={() => setForm({ ...form, driver: "simulated" })}>
                  Simulated
                </Button>
                <Button variant={form.driver === "dograh" ? "default" : "outline"} size="sm" onClick={() => setForm({ ...form, driver: "dograh" })}>
                  Dograh (real)
                </Button>
              </div>
              <Button onClick={dispatchCall} disabled={dispatching} className="w-full">
                {dispatching ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Dispatch {form.driver === "simulated" ? "simulated" : "real"} call
              </Button>
              {dispatchResult && (
                <div className={`text-sm rounded p-2 ${dispatchResult.error ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                  {dispatchResult.error ? dispatchResult.error : `Queued: ${dispatchResult.ref} (${dispatchResult.status})`}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent calls</CardTitle>
            </CardHeader>
            <CardContent>
              {calls && calls.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No calls dispatched yet.</p>
              ) : (
                <ul className="space-y-2">
                  {calls?.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between text-sm border-b pb-2">
                      <span>{c.contact_name} — {c.ref}</span>
                      <Badge variant={c.driver === "simulated" ? "secondary" : "default"}>
                        {c.driver === "simulated" ? "SIMULATED" : "REAL"} · {c.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !error && tab === "calls" && (
        <Card>
          <CardHeader><CardTitle>Call history</CardTitle></CardHeader>
          <CardContent>
            {calls && calls.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No calls yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {calls?.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">{c.ref}</TableCell>
                      <TableCell>{c.contact_name}{c.company ? ` (${c.company})` : ""}</TableCell>
                      <TableCell>
                        <Badge variant={c.driver === "simulated" ? "secondary" : "default"}>
                          {c.driver === "simulated" ? "SIMULATED" : "REAL"}
                        </Badge>
                      </TableCell>
                      <TableCell>{c.status}</TableCell>
                      <TableCell>{c.outcome ?? "—"}</TableCell>
                      <TableCell>{c.price != null ? `${c.currency ?? "INR"} ${c.price}` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !error && tab === "agents" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Agents</CardTitle>
          </CardHeader>
          <CardContent>
            {agents && agents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No agents configured yet. Agent builder UI (call-flow editor, scripts, tools) is not implemented in this batch.
              </p>
            ) : (
              <ul className="space-y-2">
                {agents?.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-sm border-b pb-2">
                    <span>{a.name} ({a.agent_key})</span>
                    <Badge variant={a.status === "active" ? "default" : "secondary"}>{a.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {tab === "scripts" && (
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          {/* ── Script library (list) ───────────────────────────────── */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Scripts
              </CardTitle>
              <Button size="sm" onClick={startNewScript}>New</Button>
            </CardHeader>
            <CardContent>
              {scriptsLoading && (
                <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading scripts…
                </div>
              )}
              {scriptsError && !scriptsLoading && (
                <div className="text-sm rounded p-2 bg-destructive/10 text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> {scriptsError}
                  <Button size="sm" variant="outline" className="ml-auto" onClick={loadScripts}>Retry</Button>
                </div>
              )}
              {!scriptsLoading && !scriptsError && scripts && scripts.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No scripts yet — these are real saved records, not sample data. Create one to get started.
                </p>
              )}
              {!scriptsLoading && !scriptsError && scripts && scripts.length > 0 && (
                <ul className="space-y-1">
                  {scripts.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => openScript(s.code)}
                        className={`w-full text-left text-sm rounded px-2 py-2 flex items-center justify-between hover:bg-muted ${
                          selectedCode === s.code ? "bg-muted" : ""
                        }`}
                      >
                        <span className="truncate">{s.name}</span>
                        <Badge variant={s.status === "published" ? "default" : s.status === "archived" ? "outline" : "secondary"}>
                          {s.status === "published" ? `v${s.version}` : s.status}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Editor / detail panel ───────────────────────────────── */}
          <div className="space-y-4">
            {!isScriptEditorOpen && (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  Select a script from the library, or click "New" to create one.
                </CardContent>
              </Card>
            )}

            {isScriptEditorOpen && detailLoading && (
              <Card>
                <CardContent className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading script…
                </CardContent>
              </Card>
            )}

            {isScriptEditorOpen && detailError && !detailLoading && (
              <Card className="border-destructive">
                <CardContent className="flex items-center gap-2 pt-4 text-destructive">
                  <AlertTriangle className="h-4 w-4" /> {detailError}
                  <Button size="sm" variant="outline" className="ml-auto" onClick={() => selectedCode && openScript(selectedCode)}>
                    Retry
                  </Button>
                </CardContent>
              </Card>
            )}

            {isScriptEditorOpen && !detailLoading && !detailError && (
              <>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{isNewScript ? "New script (draft)" : draft.name || scriptDetail?.code}</CardTitle>
                      {isNewScript ? (
                        <CardDescription>Unsaved — not yet created.</CardDescription>
                      ) : (
                        // Intentionally NOT a <CardDescription> (a <p>): Badge renders a
                        // <div>, and a <div> inside a <p> is invalid HTML React warns
                        // about at runtime (caught by the frontend test harness, not by
                        // tsc or the build). A plain flex row avoids the invalid nesting.
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                          <Badge variant={scriptDetail?.status === "published" ? "default" : scriptDetail?.status === "archived" ? "outline" : "secondary"}>
                            {scriptDetail?.status}
                          </Badge>
                          {scriptDetail?.status === "published" && <span>version {scriptDetail?.version}</span>}
                        </div>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={closeScriptEditor}>Close</Button>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isArchivedScript && (
                      <div className="text-sm rounded p-2 bg-muted text-muted-foreground flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" /> This script is archived and cannot be edited or published.
                      </div>
                    )}
                    {scriptIsDirty && (
                      <div className="text-sm rounded p-2 bg-amber-100 text-amber-900 flex items-center gap-2">
                        Unsaved changes.
                        <Button size="sm" variant="outline" className="ml-auto" onClick={discardScriptChanges}>Discard</Button>
                      </div>
                    )}

                    {isNewScript && (
                      <Input
                        placeholder="Code (e.g. rfq-followup-v1)"
                        value={draft.code}
                        onChange={(e) => setDraftField("code", e.target.value)}
                      />
                    )}
                    <Input placeholder="Name" value={draft.name} onChange={(e) => setDraftField("name", e.target.value)} />
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Language (e.g. en-IN)" value={draft.language} onChange={(e) => setDraftField("language", e.target.value)} />
                      <Input placeholder="Tone (e.g. professional)" value={draft.tone} onChange={(e) => setDraftField("tone", e.target.value)} />
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Template variables used by this script:</p>
                      <div className="flex flex-wrap gap-1">
                        {ALLOWED_SCRIPT_VARIABLES.map((v) => (
                          <Button
                            key={v}
                            type="button"
                            size="sm"
                            variant={draft.variables.includes(v) ? "default" : "outline"}
                            onClick={() => toggleScriptVariable(v)}
                          >
                            {`{{${v}}}`}
                          </Button>
                        ))}
                      </div>
                    </div>

                    {SCRIPT_SECTIONS.map(({ key, label }) => (
                      <div key={key}>
                        <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
                        <Textarea
                          rows={2}
                          value={draft[key]}
                          onChange={(e) => setDraftField(key, e.target.value)}
                          placeholder={`${label}…`}
                        />
                      </div>
                    ))}

                    {saveError && (
                      <div className="text-sm rounded p-2 bg-destructive/10 text-destructive">{saveError}</div>
                    )}
                    {saveMessage && !saveError && (
                      <div className="text-sm rounded p-2 bg-emerald-100 text-emerald-900">{saveMessage}</div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={saveScript}
                        disabled={saving || isArchivedScript || (!isNewScript && !scriptIsDirty)}
                        className="flex-1"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        {isNewScript ? "Create draft" : "Save"}
                      </Button>
                      {!isNewScript && (
                        <Button
                          variant="outline"
                          onClick={submitPublishScript}
                          disabled={publishing || isArchivedScript || scriptIsDirty}
                        >
                          {publishing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Publish
                        </Button>
                      )}
                    </div>
                    {scriptIsDirty && !isNewScript && !isArchivedScript && (
                      <p className="text-xs text-muted-foreground">Save your changes before publishing.</p>
                    )}
                    {publishError && <div className="text-sm rounded p-2 bg-destructive/10 text-destructive">{publishError}</div>}
                  </CardContent>
                </Card>

                {!isNewScript && (
                  <Card>
                    <CardHeader><CardTitle className="text-base">Duplicate as a new draft</CardTitle></CardHeader>
                    <CardContent className="flex gap-2">
                      <Input
                        placeholder="New code"
                        value={duplicateCode}
                        onChange={(e) => setDuplicateCode(e.target.value)}
                      />
                      <Button onClick={submitDuplicateScript} disabled={duplicating || !duplicateCode.trim()}>
                        {duplicating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Duplicate
                      </Button>
                    </CardContent>
                    {duplicateError && (
                      <CardContent className="pt-0">
                        <div className="text-sm rounded p-2 bg-destructive/10 text-destructive">{duplicateError}</div>
                      </CardContent>
                    )}
                  </Card>
                )}

                {!isNewScript && (
                  <Card>
                    <CardHeader><CardTitle className="text-base">Published version history</CardTitle></CardHeader>
                    <CardContent>
                      {scriptDetail?.versions.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Never published.</p>
                      ) : (
                        <ul className="space-y-1">
                          {scriptDetail?.versions.map((v) => (
                            <li key={v.id} className="flex items-center justify-between text-sm border-b pb-1">
                              <span>Version {v.version}</span>
                              <span className="text-muted-foreground text-xs">{new Date(v.published_at).toLocaleString()}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                )}

                {!isNewScript && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><Eye className="h-4 w-4" /> Preview</CardTitle>
                      <CardDescription>
                        Text preview of the last <strong>saved</strong> version only (not unsaved edits above). No call is placed and
                        no voice is synthesized.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {draft.variables.map((v) => (
                          <Input
                            key={v}
                            placeholder={v}
                            value={previewValues[v] ?? ""}
                            onChange={(e) => setPreviewValues((p) => ({ ...p, [v]: e.target.value }))}
                          />
                        ))}
                      </div>
                      <Button onClick={runScriptPreview} disabled={previewLoading} variant="outline">
                        {previewLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Run preview
                      </Button>
                      {previewError && (
                        <div className="text-sm rounded p-2 bg-destructive/10 text-destructive">{previewError}</div>
                      )}
                      {previewResult && (
                        <div className="rounded border p-3 space-y-2 bg-muted/30">
                          <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">{previewResult.disclaimer}</p>
                          {SCRIPT_SECTIONS.map(({ key, label }) =>
                            previewResult.sections?.[key] ? (
                              <div key={key} className="text-sm">
                                <span className="font-medium">{label}:</span> {unescapeHtmlEntities(previewResult.sections[key])}
                              </div>
                            ) : null,
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
