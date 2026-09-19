/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { 
  Cpu, 
  ShieldCheck, 
  ShieldAlert, 
  RotateCcw, 
  Play, 
  Layers, 
  Activity, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  Clock,
  Coins
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

interface ProviderCircuitBreaker {
  provider: string;
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
  lastFailureTime: number | null;
  cooldownMs: number;
}

interface ProviderMeta {
  provider: string;
  displayName: string;
  defaultModel: string;
  availableModels: string[];
  endpoint: string;
  envVars: string[];
  capabilities: {
    text: boolean;
    json: boolean;
    reasoning?: boolean;
    vision?: boolean;
    streaming?: boolean;
  };
  timeoutMs: number;
  isConfigured: boolean;
  envVarUsed?: string;
}

interface TelemetrySummary {
  totalRequests: number;
  successRate: number;
  averageLatencyMs: number;
  totalTokens: number;
  fallbackCount: number;
  providerBreakdown: Record<string, number>;
}

interface TelemetryRecord {
  id: string;
  requestId: string;
  provider: string;
  model: string;
  policy: string;
  latencyMs: number;
  tokens?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  status: "success" | "error";
  errorMessage?: string;
  fallbackFrom?: string;
  createdAt: string;
}

const POLICY_META: Record<string, { name: string; description: string }> = {
  balanced: {
    name: "Balanced (Default)",
    description: "Multi-tier enterprise balancing prioritizing Gemini, Nvidia, and DeepSeek with automatic failover.",
  },
  cost_optimized: {
    name: "Cost Optimized",
    description: "Lowest operational cost routing starting with Zhipu GLM and DeepSeek with fallback to Qwen.",
  },
  latency_optimized: {
    name: "Latency Optimized",
    description: "Sub-second turnaround routing optimized for real-time interactive user flows.",
  },
  reasoning: {
    name: "Reasoning & Analysis",
    description: "Deep analytical and code synthesis routing using DeepSeek-R1 and Qwen-Max.",
  },
};

export function AiRouterDashboardPage() {
  const [registry, setRegistry] = useState<ProviderMeta[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<Record<string, ProviderCircuitBreaker>>({});
  const [policies, setPolicies] = useState<Record<string, string[]>>({});
  const [telemetry, setTelemetry] = useState<TelemetrySummary | null>(null);
  const [records, setRecords] = useState<TelemetryRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Live simulator state
  const [testPrompt, setTestPrompt] = useState("Explain the architecture of an enterprise AI routing engine with circuit breakers.");
  const [testPolicy, setTestPolicy] = useState("balanced");
  const [testPreferredProvider, setTestPreferredProvider] = useState<string>("none");
  const [testExecuting, setTestExecuting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Reset breaker state
  const [resettingProvider, setResettingProvider] = useState<string | null>(null);

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      return headers;
    } catch {
      return { "Content-Type": "application/json" };
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      setRefreshing(true);
      const headers = await getAuthHeaders();

      const [dashRes, telemRes] = await Promise.all([
        fetch("/api/v1/ai-router/dashboard", { headers }),
        fetch("/api/v1/ai-router/telemetry", { headers }),
      ]);

      if (dashRes.ok) {
        const json = await dashRes.json();
        const d = json.data;
        if (d) {
          setRegistry(d.registry || []);
          setCircuitBreakers(d.circuitBreakers || {});
          setPolicies(d.policies || {});
          if (d.telemetry) setTelemetry(d.telemetry);
        }
      }

      if (telemRes.ok) {
        const telemJson = await telemRes.json();
        if (telemJson.telemetry) {
          setRecords(telemJson.telemetry);
        }
        if (telemJson.summary) {
          setTelemetry(telemJson.summary);
        }
      }
    } catch (err) {
      console.error("[AiRouterDashboard] Failed to load dashboard data:", err);
    } finally {
      setRefreshing(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  async function handleResetBreaker(providerName: string) {
    try {
      setResettingProvider(providerName);
      const headers = await getAuthHeaders();
      const res = await fetch(`/api/v1/ai-router/circuit-breakers/${providerName}/reset`, {
        method: "POST",
        headers,
      });
      if (res.ok) {
        await loadDashboardData();
      }
    } catch (err) {
      console.error("[AiRouterDashboard] Failed to reset circuit breaker:", err);
    } finally {
      setResettingProvider(null);
    }
  }

  async function handleExecuteTest() {
    if (!testPrompt.trim()) return;
    setTestExecuting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const headers = await getAuthHeaders();
      const payload: any = {
        prompt: testPrompt,
        policy: testPolicy,
      };
      if (testPreferredProvider && testPreferredProvider !== "none") {
        payload.preferredProvider = testPreferredProvider;
      }

      const res = await fetch("/api/v1/ai-router/route", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setTestError(data.error || "Route simulation/execution failed");
      } else {
        setTestResult(data);
        loadDashboardData();
      }
    } catch (err: any) {
      setTestError(err.message || String(err));
    } finally {
      setTestExecuting(false);
    }
  }

  const configuredCount = registry.filter((p) => p.isConfigured).length;
  const breakerValues = Object.values(circuitBreakers);
  const trippedCount = breakerValues.filter((b) => b.state === "OPEN").length;
  const healthyCount = breakerValues.filter((b) => b.state === "CLOSED").length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary/10 rounded-xl text-primary border border-primary/20">
            <Cpu className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">AI Router Engine</h1>
            <p className="text-muted-foreground text-sm">
              Autonomous multi-provider routing, circuit breakers, failover orchestration, and telemetry.
            </p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={loadDashboardData}
          disabled={refreshing}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold">Configured Providers</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>{configuredCount} / {registry.length || 6}</span>
              <Cpu className="h-5 w-5 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {configuredCount} live server credential{configuredCount === 1 ? "" : "s"} resolved
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold">Circuit Breakers</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span className={trippedCount > 0 ? "text-destructive" : "text-green-500"}>
                {trippedCount > 0 ? `${trippedCount} Tripped` : "All Healthy"}
              </span>
              {trippedCount > 0 ? (
                <ShieldAlert className="h-5 w-5 text-destructive" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-green-500" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {healthyCount} closed, {trippedCount} open
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold">Routing Policies</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>{Object.keys(policies).length || 4}</span>
              <Layers className="h-5 w-5 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              Balanced, Cost, Latency, Reasoning
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="text-xs uppercase font-semibold">Telemetry Success Rate</CardDescription>
            <CardTitle className="text-2xl font-bold flex items-center justify-between">
              <span>
                {telemetry ? `${telemetry.successRate}%` : "100%"}
              </span>
              <Activity className="h-5 w-5 text-muted-foreground" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              Avg latency: {telemetry ? `${telemetry.averageLatencyMs}ms` : "0ms"} ({telemetry?.totalRequests || 0} calls)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full md:w-auto">
          <TabsTrigger value="overview">Providers & Breakers</TabsTrigger>
          <TabsTrigger value="policies">Routing Policies</TabsTrigger>
          <TabsTrigger value="tester">Route Simulator</TabsTrigger>
          <TabsTrigger value="telemetry">Telemetry Logs</TabsTrigger>
        </TabsList>

        {/* TAB 1: Overview */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Provider Matrix & Circuit Breaker Health</CardTitle>
              <CardDescription>
                Live status of server-side provider adapters, authentication availability, and failure isolation.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Configured</TableHead>
                    <TableHead>Breaker State</TableHead>
                    <TableHead>Default Model</TableHead>
                    <TableHead>Env Key Source</TableHead>
                    <TableHead>Consecutive Fails</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registry.map((p) => {
                    const breaker = circuitBreakers[p.provider];
                    const isOpen = breaker?.state === "OPEN";
                    const isHalfOpen = breaker?.state === "HALF_OPEN";

                    return (
                      <TableRow key={p.provider}>
                        <TableCell className="font-medium">
                          <div>
                            <span className="font-semibold">{p.displayName}</span>
                            <span className="text-xs text-muted-foreground ml-2 font-mono">({p.provider})</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.isConfigured ? (
                            <Badge variant="outline" className="border-green-500/30 text-green-500 bg-green-500/10">
                              <CheckCircle2 className="h-3 w-3 mr-1" /> Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/10">
                              <AlertTriangle className="h-3 w-3 mr-1" /> Missing Key
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isOpen ? (
                            <Badge variant="destructive" className="flex w-fit items-center gap-1">
                              <ShieldAlert className="h-3 w-3" /> OPEN (Tripped)
                            </Badge>
                          ) : isHalfOpen ? (
                            <Badge variant="outline" className="border-amber-500 text-amber-500 flex w-fit items-center gap-1">
                              <Clock className="h-3 w-3" /> HALF-OPEN (Canary)
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-green-500 text-green-500 flex w-fit items-center gap-1">
                              <ShieldCheck className="h-3 w-3" /> CLOSED (Healthy)
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {p.defaultModel}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-muted-foreground">
                            {p.envVarUsed || p.envVars.join(" / ")}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {breaker?.consecutiveFailures || 0} / 3
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!isOpen && (breaker?.consecutiveFailures ?? 0) === 0 || resettingProvider === p.provider}
                            onClick={() => handleResetBreaker(p.provider)}
                            className="text-xs h-8"
                          >
                            <RotateCcw className={`h-3.5 w-3.5 mr-1 ${resettingProvider === p.provider ? "animate-spin" : ""}`} />
                            Reset
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: Policies */}
        <TabsContent value="policies" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(policies).map(([polKey, chain]) => {
              const info = POLICY_META[polKey] || { name: polKey, description: "Routing policy chain" };

              return (
                <Card key={polKey} className="flex flex-col justify-between">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{info.name}</CardTitle>
                      <Badge variant="outline" className="font-mono text-xs uppercase">{polKey}</Badge>
                    </div>
                    <CardDescription>{info.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Priority Fallback Chain</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      {chain.map((provName, idx) => {
                        const prov = registry.find((p) => p.provider === provName);
                        const isConfigured = prov?.isConfigured ?? false;
                        const isTripped = circuitBreakers[provName]?.state === "OPEN";

                        return (
                          <div key={provName} className="flex items-center gap-2">
                            <Badge 
                              variant={isTripped ? "destructive" : isConfigured ? "default" : "secondary"}
                              className="px-2.5 py-1 text-xs flex items-center gap-1 font-mono"
                            >
                              <span>{idx + 1}. {prov?.displayName || provName}</span>
                              {isTripped && <span className="text-[10px] uppercase font-bold">(Tripped)</span>}
                              {!isConfigured && <span className="text-[10px] uppercase font-bold">(No Key)</span>}
                            </Badge>
                            {idx < chain.length - 1 && (
                              <span className="text-muted-foreground text-xs">&rarr;</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* TAB 3: Route Simulator */}
        <TabsContent value="tester" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Live Policy Route Simulator</CardTitle>
              <CardDescription>
                Simulate prompt routing across policies or test specific provider overrides with real-time failover detection.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Routing Policy</Label>
                  <Select value={testPolicy} onValueChange={setTestPolicy}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Policy" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="balanced">Balanced (Gemini &rarr; Nvidia &rarr; DeepSeek &rarr; Qwen)</SelectItem>
                      <SelectItem value="cost_optimized">Cost Optimized (GLM &rarr; DeepSeek &rarr; Qwen &rarr; Gemini)</SelectItem>
                      <SelectItem value="latency_optimized">Latency Optimized (Gemini &rarr; Nvidia &rarr; GLM)</SelectItem>
                      <SelectItem value="reasoning">Reasoning & Complex Tasks (DeepSeek &rarr; Qwen &rarr; Nvidia)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Preferred Provider Override (Optional)</Label>
                  <Select value={testPreferredProvider} onValueChange={setTestPreferredProvider}>
                    <SelectTrigger>
                      <SelectValue placeholder="No override (use policy chain)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (Strict Policy Dispatch)</SelectItem>
                      {registry.map((p) => (
                        <SelectItem key={p.provider} value={p.provider}>
                          {p.displayName} {p.isConfigured ? "" : "(Not configured)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Test Prompt</Label>
                <Textarea 
                  rows={4} 
                  value={testPrompt} 
                  onChange={(e) => setTestPrompt(e.target.value)}
                  placeholder="Type an evaluation prompt to test router dispatch..."
                />
              </div>

              <div className="flex justify-end">
                <Button 
                  onClick={handleExecuteTest}
                  disabled={testExecuting || !testPrompt.trim()}
                  className="flex items-center gap-2"
                >
                  <Play className={`h-4 w-4 ${testExecuting ? "animate-spin" : ""}`} />
                  {testExecuting ? "Routing & Executing..." : "Dispatch Request"}
                </Button>
              </div>

              {testError && (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
                  <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Routing Error:</span> {testError}
                  </div>
                </div>
              )}

              {testResult && (
                <div className="mt-6 border rounded-lg p-5 bg-card/60 space-y-4">
                  {/* Simulation summary */}
                  {testResult.simulation && (
                    <div className="p-3 bg-muted/40 rounded-md border text-xs space-y-1">
                      <div className="font-semibold text-muted-foreground uppercase">Simulation Result</div>
                      <div className="flex flex-wrap gap-4 pt-1">
                        <div><span className="text-muted-foreground">Primary Provider:</span> <strong className="font-mono">{testResult.simulation.selectedProvider || "None viable"}</strong></div>
                        <div><span className="text-muted-foreground">Viable Count:</span> <strong className="font-mono">{testResult.simulation.totalViableProviders}</strong></div>
                        <div><span className="text-muted-foreground">Fallback Order:</span> <span className="font-mono">{testResult.simulation.fallbackChain?.join(" &rarr; ") || "None"}</span></div>
                      </div>
                    </div>
                  )}

                  {/* Execution summary */}
                  {testResult.execution && (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                        <div className="flex items-center gap-3">
                          <Badge className="bg-primary text-primary-foreground font-mono">
                            Executed By: {testResult.execution.provider?.toUpperCase()}
                          </Badge>
                          <span className="text-xs font-mono text-muted-foreground">
                            Model: {testResult.execution.model}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            {testResult.execution.latencyMs}ms
                          </span>
                          {testResult.execution.tokens && (
                            <span className="flex items-center gap-1 font-mono">
                              <Coins className="h-3.5 w-3.5 text-amber-500" />
                              {testResult.execution.tokens.totalTokens || testResult.execution.tokens} tokens
                            </span>
                          )}
                        </div>
                      </div>

                      {testResult.execution.fallbackFrom && (
                        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-400 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span>
                            Failover Occurred: Primary provider {testResult.execution.fallbackFrom} failed, automatically recovered by {testResult.execution.provider}.
                          </span>
                        </div>
                      )}

                      <div className="space-y-1">
                        <Label className="text-xs uppercase text-muted-foreground">Response Content</Label>
                        <div className="p-4 rounded-md bg-muted/50 text-sm font-sans whitespace-pre-wrap leading-relaxed">
                          {testResult.execution.text}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: Telemetry */}
        <TabsContent value="telemetry" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Router Telemetry</CardTitle>
              <CardDescription>
                Execution audit log of router dispatches, fallback events, and latency metrics.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {records.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  No telemetry records recorded yet. Run a prompt through the Route Simulator or Prompt Studio.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Policy</TableHead>
                      <TableHead>Resolved Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Tokens</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Failover</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((rec) => (
                      <TableRow key={rec.id}>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {new Date(rec.createdAt).toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] uppercase font-mono">
                            {rec.policy}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-xs font-mono">
                          {rec.provider}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {rec.model}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {rec.latencyMs}ms
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {rec.tokens?.totalTokens || "-"}
                        </TableCell>
                        <TableCell>
                          {rec.status === "success" ? (
                            <Badge variant="outline" className="border-green-500/30 text-green-500 text-[10px]">
                              SUCCESS
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-[10px]">
                              ERROR
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {rec.fallbackFrom ? (
                            <span className="text-amber-500 text-[11px] font-semibold">
                              From: {rec.fallbackFrom}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-[11px]">Direct</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
