import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

/**
 * PHASE 4A blocker remediation (TASK-07 / GOV-3 / FD-3):
 * this page previously showed four entirely fictional users (Alice Smith,
 * Bob Jones, Charlie Day, Diana Prince) as a hardcoded array, three
 * fabricated "Audit Logs" lines with fake timestamps, and "Invite User" /
 * "Edit" / "View All Logs" buttons with no click handlers at all.
 * AdminService.getUsers()/getAuditLogs() are stubs returning [], and real
 * user administration would require a SUPABASE_SERVICE_KEY this repository
 * does not hold and this session correctly does not request.
 *
 * Per the Master Plan's two sanctioned resolutions for this kind of page
 * (wire to real data/actions, or mark unambiguously non-functional and hide
 * from navigation), this session implements the second: no fabricated data
 * remains, and its nav entry has been removed from AppLayout.tsx. The route
 * itself is intentionally left in place (not deleted) so a user who reaches
 * this URL directly sees this honest message instead of nothing.
 */
export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
        <p className="text-muted-foreground">
          User administration is not implemented yet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Not available yet</CardTitle>
          <CardDescription>
            Inviting users, editing roles, and viewing an audit log all require
            server-side infrastructure (a service-role admin API and a durable
            audit sink) that does not exist in this repository yet. This page
            previously showed fictional users and fabricated log entries as if
            they were real; that has been removed rather than left misleading.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Team membership can be reviewed today from{" "}
              <a href="/team" className="underline">
                Team
              </a>
              , and organization-level roles from{" "}
              <a href="/organization" className="underline">
                Organization
              </a>{" "}
              — both backed by real data, unlike this page.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
