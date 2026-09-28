import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { communicationsApi, errorText } from "@/lib/communicationsApi";
import type { CommHealthResult, CommProvider } from "@/types/communications";
import { EmptyState, ErrorNote, formatDate, LoadingRow, StatusBadge, ToneBadge } from "./shared";

/**
 * Read-only by design. Provider rows and their credentials are operator-managed (database rows +
 * server environment variables); nothing here can create one, and no secret value is ever shown.
 * "Verified" means a real message has been sent through this provider — configuration alone is not.
 */
export function ProvidersTab() {
  const [providers, setProviders] = useState<CommProvider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CommHealthResult | { error: string }>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      setProviders((await communicationsApi.listProviders()).providers);
    } catch (e) {
      setProviders(null);
      setError(errorText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function check(id: string) {
    setChecking(id);
    try {
      const r = await communicationsApi.healthCheck(id);
      setResults((prev) => ({ ...prev, [id]: r }));
      await load();
    } catch (e) {
      setResults((prev) => ({ ...prev, [id]: { error: errorText(e) } }));
    } finally {
      setChecking(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Providers</CardTitle>
          <CardDescription>
            Approved providers: Resend and SMTP (email), Meta WhatsApp Cloud API (WhatsApp), MSG91 (SMS/OTP, not implemented yet). Provider rows are managed by
            operators in the database and credentials live in server environment variables — this page only reports their state.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <ErrorNote message={error} />
        {providers === null && !error && <LoadingRow />}
        {providers && providers.length === 0 && (
          <EmptyState
            title="No providers configured for this organization"
            hint="Until an operator adds a provider row and sets its credential on the server, every send fails with PROVIDER_NOT_CONFIGURED and is logged as failed."
          />
        )}
        {providers && providers.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Implementation</TableHead>
                <TableHead>Credentials</TableHead>
                <TableHead>Verified by a real send</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.map((p) => {
                const r = results[p.id];
                return (
                  <TableRow key={p.id} className={p.isActive ? "" : "opacity-60"}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.provider} · priority {p.priority}
                        {!p.isActive && " · inactive"}
                      </div>
                    </TableCell>
                    <TableCell>{p.channelType}</TableCell>
                    <TableCell>
                      <ToneBadge tone={p.implementation === "live-capable" ? "info" : "warning"}>
                        {p.implementation === "live-capable" ? "can send" : p.implementation === "stub" ? "stub — cannot send" : "no adapter"}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      <ToneBadge tone={p.credentialsConfigured ? "success" : "danger"}>{p.credentialsConfigured ? "configured" : "missing"}</ToneBadge>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">{p.credentialsRef}</div>
                    </TableCell>
                    <TableCell>
                      {p.verified ? (
                        <ToneBadge tone="success">verified · {formatDate(p.lastSuccessAt)}</ToneBadge>
                      ) : (
                        <ToneBadge tone="warning">unverified</ToneBadge>
                      )}
                      {p.lastFailureAt && <div className="mt-1 text-xs text-muted-foreground">last failure {formatDate(p.lastFailureAt)}</div>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.healthStatus} />
                      <div className="mt-1 text-xs text-muted-foreground">{p.lastHealthCheckAt ? formatDate(p.lastHealthCheckAt) : "never checked"}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" disabled={checking === p.id} onClick={() => void check(p.id)}>
                        <Activity className="mr-2 h-4 w-4" />
                        {checking === p.id ? "Checking…" : "Health check"}
                      </Button>
                      {r && (
                        <p className="mt-2 max-w-[16rem] break-words text-right text-xs text-muted-foreground">
                          {"error" in r ? r.error : `${r.status.replace("_", " ")}${r.detail ? ` — ${r.detail}` : ""}`}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
