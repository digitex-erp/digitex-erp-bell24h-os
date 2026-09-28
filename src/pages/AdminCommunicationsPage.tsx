import { useState } from "react";
import { BarChart3, Ban, CalendarClock, FileText, LayoutDashboard, MessageSquare, Megaphone, ScrollText, Server, ShieldAlert, Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsTab } from "@/components/communications/AnalyticsTab";
import { AudienceTab } from "@/components/communications/AudienceTab";
import { CampaignDetailDialog } from "@/components/communications/CampaignDetailDialog";
import { CampaignsTab } from "@/components/communications/CampaignsTab";
import { DashboardTab } from "@/components/communications/DashboardTab";
import { LogsTab } from "@/components/communications/LogsTab";
import { ProvidersTab } from "@/components/communications/ProvidersTab";
import { SchedulesTab } from "@/components/communications/SchedulesTab";
import { SuppressionsTab } from "@/components/communications/SuppressionsTab";
import { TemplatesTab } from "@/components/communications/TemplatesTab";

/**
 * /admin/communications — the Communication Hub admin console (Sprint CH-02).
 *
 * Everything on this page is backed by /api/communications/* and shows real state. There is no sample
 * data and no simulated success: when no provider is configured, sends fail and the Logs tab shows the
 * real error. Access is enforced by the server (roles ADMIN / MANAGER / EDITOR / VIEWER); a signed-in user
 * without the right role sees the server's refusal, not a blank page.
 */
export function AdminCommunicationsPage() {
  const [tab, setTab] = useState("dashboard");
  const [logCampaign, setLogCampaign] = useState<string | undefined>();
  const [analyticsCampaign, setAnalyticsCampaign] = useState<string | null>(null);

  const trigger =
    "data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4";

  return (
    <div className="space-y-6 pb-10">
      <div className="space-y-2">
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <MessageSquare className="h-7 w-7 text-primary" />
          Communications
        </h1>
        <p className="text-muted-foreground">Templates, audiences, campaigns, suppressions, analytics, delivery logs and provider status for email, WhatsApp and SMS.</p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <p>
          <strong>Nothing here is simulated.</strong> A message is sent only if a provider is configured on the server and working. A campaign cannot be scheduled or
          executed until a real test message has been sent. Check the <em>Providers</em> tab to see what is actually configured and verified.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <div className="overflow-x-auto border-b">
          <TabsList className="h-12 w-full justify-start space-x-4 bg-transparent">
            <TabsTrigger value="dashboard" className={trigger}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="templates" className={trigger}>
              <FileText className="mr-2 h-4 w-4" />
              Templates
            </TabsTrigger>
            <TabsTrigger value="audience" className={trigger}>
              <Users className="mr-2 h-4 w-4" />
              Audience
            </TabsTrigger>
            <TabsTrigger value="campaigns" className={trigger}>
              <Megaphone className="mr-2 h-4 w-4" />
              Campaigns
            </TabsTrigger>
            <TabsTrigger value="schedules" className={trigger}>
              <CalendarClock className="mr-2 h-4 w-4" />
              Schedules
            </TabsTrigger>
            <TabsTrigger value="analytics" className={trigger}>
              <BarChart3 className="mr-2 h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="suppressions" className={trigger}>
              <Ban className="mr-2 h-4 w-4" />
              Suppressions
            </TabsTrigger>
            <TabsTrigger value="logs" className={trigger}>
              <ScrollText className="mr-2 h-4 w-4" />
              Logs
            </TabsTrigger>
            <TabsTrigger value="providers" className={trigger}>
              <Server className="mr-2 h-4 w-4" />
              Providers
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="dashboard">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="templates">
          <TemplatesTab />
        </TabsContent>
        <TabsContent value="audience">
          <AudienceTab />
        </TabsContent>
        <TabsContent value="campaigns">
          <CampaignsTab
            onViewLogs={(id) => {
              setLogCampaign(id);
              setTab("logs");
            }}
          />
        </TabsContent>
        <TabsContent value="schedules">
          <SchedulesTab
            onViewLogs={(id) => {
              setLogCampaign(id);
              setTab("logs");
            }}
          />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab onOpenCampaign={setAnalyticsCampaign} />
        </TabsContent>
        <TabsContent value="suppressions">
          <SuppressionsTab />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab focusCampaignId={logCampaign} />
        </TabsContent>
        <TabsContent value="providers">
          <ProvidersTab />
        </TabsContent>
      </Tabs>

      <CampaignDetailDialog
        campaignId={analyticsCampaign}
        onClose={() => setAnalyticsCampaign(null)}
        onChanged={() => undefined}
        onViewLogs={(id) => {
          setAnalyticsCampaign(null);
          setLogCampaign(id);
          setTab("logs");
        }}
      />
    </div>
  );
}
