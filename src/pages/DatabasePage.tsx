import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Server, HardDrive } from "lucide-react";

export function DatabasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Database Overview</h1>
        <p className="text-muted-foreground">
          Supabase PostgreSQL integration health and metrics.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Connection Pool</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">42 / 100</div>
            <p className="text-xs text-muted-foreground">Active connections</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Storage</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">14.2 GB</div>
            <p className="text-xs text-muted-foreground">Of 50GB quota used</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Query Latency</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12ms</div>
            <p className="text-xs text-muted-foreground">p95 read latency</p>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Prisma Schema Status</CardTitle>
          <CardDescription>
            Current ORM models mapped to the PostgreSQL instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary">User</Badge>
            <Badge variant="secondary">Organization</Badge>
            <Badge variant="secondary">Role</Badge>
            <Badge variant="secondary">ApiKey</Badge>
            <Badge variant="secondary">Settings</Badge>
            <Badge variant="secondary">AiProvider</Badge>
            <Badge variant="secondary">AuditLog</Badge>
            <Badge variant="secondary">Session</Badge>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Schema is fully synchronized with the production database.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
