import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommCampaign } from "@/types/communications";
import { CampaignDetailDialog } from "./CampaignDetailDialog";
import { CampaignWizard } from "./CampaignWizard";
import { EmptyState, ErrorNote, formatDate, LoadingRow, StatusBadge } from "./shared";

export function CampaignsTab({ onViewLogs }: { onViewLogs: (campaignId: string) => void }) {
  const [campaigns, setCampaigns] = useState<CommCampaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCampaigns((await communicationsApi.listCampaigns()).campaigns);
    } catch (e) {
      setCampaigns(null);
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
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>
            Select leads → create → send a test → schedule or execute. A campaign can only be scheduled or executed after a real test message has been sent.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New campaign
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNote message={error} />
        {campaigns === null && !error && <LoadingRow />}
        {campaigns && campaigns.length === 0 && (
          <EmptyState title="No campaigns yet" hint="Create a template first, then start a campaign from your contacts." />
        )}
        {campaigns && campaigns.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Sent</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpenId(c.id)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{c.channel_type}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-right">{c.total_recipients}</TableCell>
                  <TableCell className="text-right">{c.sent_count}</TableCell>
                  <TableCell className="text-right">{c.failed_count}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.scheduled_at)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CampaignWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={(id) => {
          setWizardOpen(false);
          setOpenId(id);
          void load();
        }}
      />
      <CampaignDetailDialog
        campaignId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
        onViewLogs={(id) => {
          setOpenId(null);
          onViewLogs(id);
        }}
      />
    </Card>
  );
}
