import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommChannel, CommTemplate } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow, ToneBadge } from "./shared";

export function TemplatesTab() {
  const [templates, setTemplates] = useState<CommTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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
            Reusable message content. Placeholders like <code>{"{{first_name}}"}</code>, <code>{"{{last_name}}"}</code> and{" "}
            <code>{"{{company}}"}</code> are filled from each lead when a campaign runs.
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
    </Card>
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
