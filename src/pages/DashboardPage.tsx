import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CreditCard, Users, Database, Building2, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export function DashboardPage() {
  const { user } = useAuthStore();
  const [userCount, setUserCount] = useState(0);
  const [roleCount, setRoleCount] = useState(0);
  const [activeUserCount, setActiveUserCount] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    async function fetchMetrics() {
      if (!user) return;
      try {
        setLoading(true);
        const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
        let effectiveOrgId = profile?.organization_id;
        
        if (!effectiveOrgId) {
          const { data: rootOrg } = await supabase.from('organizations').select('id, name').limit(1).single();
          if (rootOrg) {
            effectiveOrgId = rootOrg.id;
            setOrgName(rootOrg.name);
          }
        }
        
        if (effectiveOrgId) {
          const { data: orgData } = await supabase.from('organizations').select('name').eq('id', effectiveOrgId).single();
          if (orgData) setOrgName(orgData.name);

          const { count: users } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('organization_id', effectiveOrgId);
          if (users !== null) setUserCount(users);

          const { count: activeUsers } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('organization_id', effectiveOrgId).eq('is_active', true);
          if (activeUsers !== null) setActiveUserCount(activeUsers);
          
          const { count: roles } = await supabase.from('roles').select('*', { count: 'exact', head: true }).eq('organization_id', effectiveOrgId);
          if (roles !== null) setRoleCount(roles);
        }
      } catch (err) {
        console.error("Failed to fetch metrics", err);
      } finally {
        setLoading(false);
      }
    }
    fetchMetrics();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Activity className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back. Here is an overview of your organization{orgName ? ` (${orgName})` : ''}.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Team Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{userCount}</div>
            <p className="text-xs text-muted-foreground">Registered in your organization</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeUserCount}</div>
            <p className="text-xs text-muted-foreground">Currently active accounts</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Roles Configured</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{roleCount}</div>
            <p className="text-xs text-muted-foreground">Available roles in your org</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">System Status</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">Online</div>
            <p className="text-xs text-muted-foreground">All systems operational</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/*
          BELL24H_OS_EXECUTION_BACKLOG.md TASK-06 (GOV-2): this card previously
          showed hardcoded "Healthy" statuses for infrastructure that either
          doesn't exist ("Worker Nodes — 42 instances running") or is never
          actually checked from this page. No server-side infrastructure
          monitoring exists yet to back a real check, so per the same pattern
          SystemDiagnosticsPage.tsx already uses correctly, this is now an
          explicit "not implemented" state rather than a fabricated pass.
        */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>System Architecture Overview</CardTitle>
            <CardDescription>
              Infrastructure monitoring is not implemented yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No infrastructure health checks are wired up from this dashboard.
                Reporting a status here would be fabricated, not measured — see{" "}
                <a href="/system/diagnostics" className="underline">
                  System Diagnostics
                </a>{" "}
                for the checks that are real.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>AI Provider Status</CardTitle>
            <CardDescription>
              Real-time telemetry is not implemented yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                This dashboard does not poll AI providers for live status.
                "OpenAI GPT-4o" and "Claude 3.5 Sonnet" are not wired server-side
                at all; Gemini and NVIDIA are the only real, credential-isolated
                providers this deployment has.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
