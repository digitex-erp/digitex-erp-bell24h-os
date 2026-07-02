import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CreditCard, DollarSign, Users, Server, BrainCircuit, Cpu, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Welcome back to Bell24h-OS. Here is an overview of your platform.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">$45,231.89</div>
            <p className="text-xs text-muted-foreground">+20.1% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+2350</div>
            <p className="text-xs text-muted-foreground">+180.1% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Sales</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+12,234</div>
            <p className="text-xs text-muted-foreground">+19% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Now</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+573</div>
            <p className="text-xs text-muted-foreground">+201 since last hour</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>System Architecture Overview</CardTitle>
            <CardDescription>
              Status of all running nodes and microservices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Server className="h-5 w-5 text-primary" />
                </div>
                <div className="ml-4 space-y-1">
                  <p className="text-sm font-medium leading-none">Core API Gateway</p>
                  <p className="text-sm text-muted-foreground">us-east-1</p>
                </div>
                <div className="ml-auto font-medium text-emerald-500">
                  Healthy
                </div>
              </div>
              <div className="flex items-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Database className="h-5 w-5 text-primary" />
                </div>
                <div className="ml-4 space-y-1">
                  <p className="text-sm font-medium leading-none">Supabase Postgres</p>
                  <p className="text-sm text-muted-foreground">Replication Active</p>
                </div>
                <div className="ml-auto font-medium text-emerald-500">
                  Healthy
                </div>
              </div>
              <div className="flex items-center">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Cpu className="h-5 w-5 text-primary" />
                </div>
                <div className="ml-4 space-y-1">
                  <p className="text-sm font-medium leading-none">Worker Nodes</p>
                  <p className="text-sm text-muted-foreground">42 instances running</p>
                </div>
                <div className="ml-auto font-medium text-emerald-500">
                  Healthy
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>AI Provider Status</CardTitle>
            <CardDescription>
              Real-time telemetry from AI inference layer.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Gemini 1.5 Pro</span>
                </div>
                <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">Operational</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">OpenAI GPT-4o</span>
                </div>
                <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">Operational</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Claude 3.5 Sonnet</span>
                </div>
                <Badge variant="default" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">Operational</Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">DeepSeek V3</span>
                </div>
                <Badge variant="outline" className="text-amber-500 border-amber-500/20 bg-amber-500/10">Degraded</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
