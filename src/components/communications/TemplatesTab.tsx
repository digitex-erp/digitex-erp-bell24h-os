import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import { templateHasUnsubscribe } from "@/lib/communicationsFlow";
import type { CommChannel, CommTemplate } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow, ToneBadge } from "./shared";

export function TemplatesTab() {
  const [templates, setTemplates] = useState<CommTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CommTemplate | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTemplates((await communicationsApi.listTemplates()).templates);
    } catch (e) {
      setTemplates(null);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Templates</CardTitle>
          <CardDescription>
            Reusable message content. Placeholders like <code>{"{{first_name}}"}</code>, <code>{"{{last_name}}"}</code> and <code>{"{{company}}"}</code> are filled
            from each lead when a campaign runs. Email templates used in campaigns must contain <code>{"{{unsubscribe_url}}"}</code>.
          </CardDescription>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> New template
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNote message={error} />
        {templates === null && !error && <LoadingRow />}
        {templates && templates.length === 0 && (
          <EmptyState title="No templates yet" hint="Create a template, then use it in a campaign or a single send." />
        )}
        {templates && templates.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.name}</TableCell>
                  <TableCell>{t.channel_type}</TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{t.subject ?? "—"}</TableCell>
                  <TableCell>
                    <ToneBadge tone={t.is_active ? "success" : "neutral"}>{t.is_active ? "active" : "inactive"}</ToneBadge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(t.created_at)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(t)} aria-label={`Edit ${t.name}`}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NewTemplateDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={() => {
          setOpen(false);
          void load();
        }}
      />
      <EditTemplateDialog
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    </Card>
  );
}

function UnsubscribeHint({ channel, body }: { channel: string; body: string }) {
  if (channel !== "email") return null;
  return templateHasUnsubscribe(body) ? (
    <p className="text-xs text-emerald-600 dark:text-emerald-400">Contains the unsubscribe link placeholder.</p>
  ) : (
    <p className="text-xs text-amber-600 dark:text-amber-400">
      No <code>{"{{unsubscribe_url}}"}</code> yet. Fine for single sends, but a campaign using this template will be refused. Example:{" "}
      <code>{'<a href="{{unsubscribe_url}}">Unsubscribe</a>'}</code>
    </p>
  );
}

function NewTemplateDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<CommChannel>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setSubject("");
    setBody("");
    setError(null);
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.createTemplate({ name, channelType: channel, subject: channel === "email" ? subject || undefined : undefined, body });
      reset();
      onCreated();
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
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            WhatsApp messages outside Meta's 24-hour window must use a Meta-approved template; approval happens in Meta, not here.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
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
          {channel === "email" && (
            <div className="space-y-2">
              <Label htmlFor="tpl-subject">Subject</Label>
              <Input id="tpl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="tpl-body">Body</Label>
            <Textarea id="tpl-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="text-xs text-muted-foreground">Email bodies are sent as HTML. Line breaks are rejected in subjects.</p>
            <UnsubscribeHint channel={channel} body={body} />
          </div>
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || name.trim() === "" || body.trim() === ""}>
            {busy ? "Saving…" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edits an existing template. The channel is fixed. While an unfinished campaign (draft / scheduled / running /
 * paused) uses the template, the server refuses content changes and deactivation with `template_in_use`; renaming
 * is always allowed. That refusal is shown as-is rather than guessed at here.
 */
function EditTemplateDialog({ template, onClose, onSaved }: { template: CommTemplate | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setSubject(template.subject ?? "");
    setBody(template.body);
    setActive(template.is_active);
    setError(null);
  }, [template]);

  async function submit() {
    if (!template) return;
    // Send only what changed, so an untouched field can never trip the in-use lock.
    const patch: { name?: string; subject?: string; body?: string; isActive?: boolean } = {};
    if (name !== template.name) patch.name = name;
    if (template.channel_type === "email" && subject !== (template.subject ?? "")) patch.subject = subject;
    if (body !== template.body) patch.body = body;
    if (active !== template.is_active) patch.isActive = active;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await communicationsApi.updateTemplate(template.id, patch);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={template !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
          <DialogDescription>
            Channel: {template?.channel_type}. Content and deactivation are locked while an unfinished campaign uses this template; renaming is always allowed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
          {template?.channel_type === "email" && (
            <div className="space-y-2">
              <Label htmlFor="edit-subject">Subject</Label>
              <Input id="edit-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-body">Body</Label>
            <Textarea id="edit-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
            <UnsubscribeHint channel={template?.channel_type ?? ""} body={body} />
          </div>
          <div className="flex items-center gap-3">
            <Switch id="edit-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="edit-active">{active ? "Active (can be used in campaigns)" : "Inactive"}</Label>
          </div>
          <ErrorNote message={error} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || name.trim() === "" || body.trim() === ""}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
