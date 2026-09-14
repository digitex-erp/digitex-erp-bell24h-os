import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

/**
 * PHASE 4A blocker remediation (TASK-07 / GOV-3 / FD-3):
 * this page previously presented entirely fabricated data as real — a
 * hardcoded name and email ("John Doe" / "john.doe@example.com"), a masked
 * API key input implying a Gemini key was already configured when none was,
 * and a "Save Changes" button with no click handler at all, across 6 tabs
 * (profile, security, AI keys, notifications, billing, integrations) with no
 * backing service for any of them (SettingsService.ts is a stub).
 *
 * Per the Master Plan's two sanctioned resolutions for this kind of page
 * (wire to real data/actions, or mark unambiguously non-functional and hide
 * from navigation), this session implements the second: no fabricated data
 * remains, and its nav entry has been removed from AppLayout.tsx. The route
 * itself is intentionally left in place (not deleted) so a user who reaches
 * this URL directly sees this honest message instead of nothing.
 */
export function SettingsPage() {
  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Account settings are not implemented yet.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Not available yet</CardTitle>
          <CardDescription>
            Profile editing, password management, AI provider key configuration,
            notification preferences, billing, and third-party integrations are
            not built in this repository yet — there is no backend to save any
            of them to. This page previously showed placeholder data as if it
            were real; that has been removed rather than left misleading.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-md border border-dashed p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              AI provider credentials can be managed today from{" "}
              <a href="/ai-providers" className="underline">
                AI Providers
              </a>{" "}
              instead — that page is backed by a real table, unlike this one.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
