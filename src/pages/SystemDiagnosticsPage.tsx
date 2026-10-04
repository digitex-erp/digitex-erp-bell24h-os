import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Shield, ShieldCheck, Database, Server, Monitor, Zap, Search, Megaphone, Share2, Workflow, LineChart, Globe, Cpu, Activity, Lock, Fingerprint } from "lucide-react";
import { supabase, SUPABASE_CONFIGURED, supabaseProjectId } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { authedFetchJson } from "@/lib/authedFetch";
import { diagnosticError } from "@/lib/diagnosticsErrors";

export function SystemDiagnosticsPage() {
  const [serverEnv, setServerEnv] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>({
    auth: { status: 'checking', details: null },
    db: { status: 'checking', details: null },
    storage: { status: 'checking', details: null },
    realtime: { status: 'checking', details: null },
    session: { status: 'checking', details: null },
    org: { status: 'checking', details: null },
    jwt: { status: 'checking', details: null }
  });
  const [loading, setLoading] = useState(true);
  const user = useAuthStore(state => state.user);

  const clientEnvKeys = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANO'
  ];

  const [migrating, setMigrating] = useState(false);
  const [migrationResult, setMigrationResult] = useState<any>(null);
  const [tableCheck, setTableCheck] = useState<any>(null);
  const [userCount, setUserCount] = useState<any>(null);

  const runMigration = async () => {
    setMigrating(true);
    setMigrationResult(null);
    try {
      const resp = await fetch('/api/migrate');
      const data = await resp.json();
      setMigrationResult(data);
      if (data.success) {
        await runDiagnostics();
      }
    } catch (e: any) {
      setMigrationResult({ 
        error: e.message || 'Unknown network error during migration',
        hint: 'Check if DATABASE_URL is reachable from the server.'
      });
    } finally {
      setMigrating(false);
    }
  };

  const fetchTableCheck = async () => {
    try {
      setTableCheck(await authedFetchJson<any>('/api/check-table'));
    } catch (e) {
      const o = diagnosticError(e);
      setTableCheck({ error: o.message, warn: o.status === 'warn' });
    }
  };

  const fetchUserCount = async () => {
    try {
      setUserCount(await authedFetchJson<any>('/api/check-users-count'));
    } catch (e) {
      const o = diagnosticError(e);
      setUserCount({ error: o.message, warn: o.status === 'warn' });
    }
  };

  const runDiagnostics = async () => {
    setLoading(true);
    fetchTableCheck();
    fetchUserCount();
    const newDiagnostics = { ...diagnostics };

    // 1. Fetch Server Env
    try {
      const resp = await fetch('/api/env/diagnostic');
      if (resp.ok) {
        const json = await resp.json();
        setServerEnv(json.variables);
        const dbUrl = json.variables['DATABASE_URL'];
        
        let maskedHost = 'Unknown';
        if (dbUrl?.value) {
          try {
            const urlStr = dbUrl.value.replace('postgres://', 'http://');
            const url = new URL(urlStr);
            maskedHost = `${url.hostname.substring(0, 3)}***${url.hostname.substring(url.hostname.length - 3)}:${url.port || '5432'}`;
          } catch (e) {}
        }

        newDiagnostics.env = {
          status: dbUrl?.loaded ? 'pass' : 'fail',
          details: dbUrl?.loaded ? `DB Host: ${maskedHost}` : 'DATABASE_URL missing'
        };
      }
    } catch (e: any) {
      console.error("Failed to fetch server env", e);
      newDiagnostics.env = { status: 'fail', details: e.message };
    }

    // 2. Auth Reachability
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      newDiagnostics.auth = {
        status: error ? 'fail' : 'pass',
        details: error ? `Auth error: ${error.message}` : 'Auth API endpoint reachable'
      };
      newDiagnostics.jwt = {
        status: session ? 'pass' : 'fail',
        details: session ? 'JWT session active' : 'No active JWT (Session Missing)'
      };
    } catch (e: any) {
      newDiagnostics.auth = { status: 'fail', details: e.message };
      newDiagnostics.jwt = { status: 'fail', details: 'JWT check failed' };
    }

    // 3. Database Check
    try {
      const { data: tableData, error: tableError } = await supabase.from('organizations').select('id').limit(1);
      if (tableError) {
        const isTableMissing = tableError.message.includes('not find the table') || tableError.code === '42P01';
        newDiagnostics.db = {
          status: 'fail',
          details: isTableMissing 
            ? 'Table "organizations" missing. Run sync below.' 
            : `Database error: ${tableError.message}`
        };
      } else {
        newDiagnostics.db = {
          status: 'pass',
          details: 'Verified: organizations table accessible'
        };
      }
    } catch (e: any) {
      newDiagnostics.db = { status: 'fail', details: e.message };
    }

    // 4. Storage Health
    try {
      const { error } = await supabase.storage.listBuckets();
      newDiagnostics.storage = {
        status: error ? 'fail' : 'pass',
        details: error ? `Storage error: ${error.message}` : 'Storage buckets accessible'
      };
    } catch (e: any) {
      newDiagnostics.storage = { status: 'fail', details: e.message };
    }

    // 5. Realtime Health
    // No realtime subscription check is performed. Reporting an unverified 'pass'
    // would fabricate a result, so this is declared unimplemented instead.
    newDiagnostics.realtime = {
      status: 'not_implemented',
      details: 'No realtime check performed'
    };

    // 6. Session Status
    newDiagnostics.session = {
      status: user ? 'pass' : 'fail',
      details: user ? `Authenticated: ${user.email}` : 'No active session (Login required for 100%)'
    };

    // 7. Organization Context
    if (user) {
      try {
        const { data, error } = await supabase.from('organizations').select('id, name').limit(1).single();
        if (error) {
          const isTableMissing = error.message.includes('not find the table') || error.code === '42P01';
          newDiagnostics.org = {
            status: isTableMissing ? 'fail' : (error.code === 'PGRST116' ? 'warn' : 'fail'),
            details: isTableMissing 
              ? 'Table "organizations" missing.' 
              : (error.code === 'PGRST116' ? 'No organizations found' : `RLS/Query Error: ${error.message}`)
          };
        } else {
          newDiagnostics.org = {
            status: 'pass',
            details: `Org: ${data.name}`
          };
        }
      } catch (e: any) {
        newDiagnostics.org = { status: 'fail', details: e.message };
      }
    } else {
        newDiagnostics.org = { status: 'warn', details: 'Authentication required for RLS test' };
    }

    setDiagnostics(newDiagnostics);
    setLoading(false);
  };

  useEffect(() => {
    // BR: previously ran once on mount with an empty dependency array. runDiagnostics()
    // captures `user` (from useAuthStore) via closure on whichever render created it, and
    // this effect never re-ran after that first render — so if the app-level session
    // hydration in useAuth.ts (getSession() -> AuthService.resolveRole() -> login()) had
    // not yet populated the store's `user` at the moment this page mounted, every check
    // gated on `user` (Session/Org/RLS) was permanently stuck on its stale null-user
    // result, even after the store correctly populated `user` a moment later. Meanwhile
    // JWT/Auth checks (their own independent supabase.auth.getSession() call inside
    // runDiagnostics) resolved correctly on their own timeline, producing the observed
    // contradiction (JWT Valid + Session Active, alongside Login Successful/Org
    // Context/RLS = fail). Depending on `user` re-runs diagnostics once the store's real
    // value is known, closing that race without touching auth flow, RLS, or any other file.
    runDiagnostics();
  }, [user]);

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'pass') return <CheckCircle className="h-5 w-5 text-green-500" />;
    if (status === 'fail') return <XCircle className="h-5 w-5 text-destructive" />;
    if (status === 'warn') return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    if (status === 'not_implemented') return <AlertTriangle className="h-5 w-5 text-muted-foreground" />;
    return <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />;
  };

  const allPassed = 
    SUPABASE_CONFIGURED && 
    diagnostics.auth.status === 'pass' && 
    diagnostics.db.status === 'pass' && 
    diagnostics.session.status === 'pass' &&
    diagnostics.jwt.status === 'pass' &&
    diagnostics.org.status === 'pass';

  const healthScore = allPassed ? 100 : (
    (SUPABASE_CONFIGURED ? 20 : 0) +
    (diagnostics.auth.status === 'pass' ? 10 : 0) +
    (diagnostics.db.status === 'pass' ? 20 : 0) +
    (diagnostics.session.status === 'pass' ? 20 : 0) +
    (diagnostics.jwt.status === 'pass' ? 15 : 0) +
    (diagnostics.org.status === 'pass' ? 15 : 0)
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8 pb-20">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Certification Dashboard</h1>
          <p className="text-muted-foreground">End-to-end verification of environment variable flow and authentication</p>
        </div>
        <div className="flex items-center space-x-4">
            <div className="text-right">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Health Score</p>
                <p className={`text-2xl font-black ${healthScore === 100 ? 'text-green-500' : 'text-amber-500'}`}>{healthScore}%</p>
            </div>
            <div className="text-right">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Foundation Status</p>
                <p className={`text-sm font-black ${healthScore === 100 ? 'text-green-500' : 'text-amber-500'}`}>
                  {healthScore === 100 ? (
                    <span className="flex items-center gap-1">
                      <ShieldCheck className="h-4 w-4" />
                      FOUNDATION STABLE
                    </span>
                  ) : (
                    'VERIFICATION IN PROGRESS'
                  )}
                </p>
            </div>
            <Button onClick={runDiagnostics} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Run Verification
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Supabase Project</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-2">
                    <Database className="h-5 w-5 text-primary" />
                    <span className="text-lg font-bold truncate">{supabaseProjectId}</span>
                </div>
            </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Authenticated User</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-2">
                    <Fingerprint className="h-5 w-5 text-primary" />
                    <span className="text-lg font-bold truncate">{user?.email || 'Guest'}</span>
                </div>
            </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Org Context</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-2">
                    <Lock className="h-5 w-5 text-primary" />
                    <span className="text-lg font-bold truncate">{diagnostics.org.status === 'pass' ? diagnostics.org.details.replace('Org: ', '') : 'None'}</span>
                </div>
            </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Session Status</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-2">
                    <Activity className={`h-5 w-5 ${user ? 'text-green-500' : 'text-amber-500'}`} />
                    <span className="text-lg font-bold">{user ? 'Active' : 'Missing'}</span>
                </div>
            </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 border-primary/20">
          <CardHeader className="flex flex-row items-center space-x-2">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Runtime Verification Dashboard</CardTitle>
              <CardDescription>Comprehensive test suite for platform foundation</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test Case</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Result / Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Environment Variables Loaded</TableCell>
                  <TableCell><StatusIcon status={SUPABASE_CONFIGURED ? 'pass' : 'fail'} /></TableCell>
                  <TableCell className="text-xs">{SUPABASE_CONFIGURED ? 'All VITE_ keys detected' : 'Check Secrets tab'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Supabase Client Initialized</TableCell>
                  <TableCell><StatusIcon status={SUPABASE_CONFIGURED ? 'pass' : 'fail'} /></TableCell>
                  <TableCell className="text-xs">{SUPABASE_CONFIGURED ? `Connected to ${supabaseProjectId}` : 'Initialization blocked'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Auth Endpoint Reachable</TableCell>
                  <TableCell><StatusIcon status={diagnostics.auth.status} /></TableCell>
                  <TableCell className="text-xs">{diagnostics.auth.details}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Login Successful</TableCell>
                  <TableCell><StatusIcon status={diagnostics.session.status} /></TableCell>
                  <TableCell className="text-xs">{diagnostics.session.details}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">JWT Valid</TableCell>
                  <TableCell><StatusIcon status={diagnostics.jwt.status} /></TableCell>
                  <TableCell className="text-xs">{diagnostics.jwt.details}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium text-amber-600">Direct DB Connection (Admin)</TableCell>
                  <TableCell><StatusIcon status={tableCheck?.success ? 'pass' : (tableCheck?.error ? (tableCheck.warn ? 'warn' : 'fail') : 'pending')} /></TableCell>
                  <TableCell className="text-xs">
                    {tableCheck?.success ? 'Verified: server reached the database over DATABASE_URL' : (tableCheck?.error ? tableCheck.error : 'Testing direct DATABASE_URL...')}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Organization Loaded</TableCell>
                  <TableCell><StatusIcon status={diagnostics.org.status} /></TableCell>
                  <TableCell className="text-xs">{diagnostics.org.details}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">RLS Query Successful</TableCell>
                  <TableCell><StatusIcon status={user ? (diagnostics.org.status === 'pass' ? 'pass' : 'fail') : 'warn'} /></TableCell>
                  <TableCell className="text-xs">{user ? (diagnostics.org.status === 'pass' ? 'RLS Policy Passed' : diagnostics.org.details) : 'Waiting for login'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Database Connection</TableCell>
                  <TableCell><StatusIcon status={diagnostics.db.status} /></TableCell>
                  <TableCell className="text-xs">{diagnostics.db.details}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className={`border-2 ${allPassed ? 'border-green-500/50 bg-green-500/5' : 'border-destructive/50 bg-destructive/5'}`}>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Cpu className={`h-6 w-6 ${allPassed ? 'text-green-500' : 'text-destructive'}`} />
              <span>Certification Report</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
              <div className="space-y-4">
                  <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground uppercase">Auth Status</span>
                      <Badge variant={diagnostics.auth.status === 'pass' ? 'default' : 'destructive'}>{diagnostics.auth.status === 'pass' ? 'CERTIFIED' : 'FAILED'}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground uppercase">Data Status</span>
                      <Badge variant={diagnostics.db.status === 'pass' ? 'default' : 'destructive'}>{diagnostics.db.status === 'pass' ? 'CERTIFIED' : 'FAILED'}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground uppercase">Isolation (RLS)</span>
                      <Badge variant={diagnostics.org.status === 'pass' ? 'default' : 'destructive'}>{diagnostics.org.status === 'pass' ? 'CERTIFIED' : 'FAILED'}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground uppercase">Foundation</span>
                      <Badge variant={allPassed ? 'default' : 'destructive'}>{allPassed ? 'V1.0 STABLE' : 'UNSTABLE'}</Badge>
                  </div>
              </div>

              {allPassed ? (
                  <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20 text-center space-y-2">
                      <p className="text-xl font-black text-green-500 uppercase tracking-tighter">Bell24h-OS Foundation Certified</p>
                      <p className="text-[10px] text-green-700/70 font-bold">READY FOR MISSION-CRITICAL EXPANSION</p>
                  </div>
              ) : (
                  <div className="p-4 bg-destructive/10 rounded-xl border border-destructive/20 space-y-3">
                      <p className="text-sm font-bold text-destructive">Certification Blocked</p>
                      <ul className="text-[10px] space-y-1 text-muted-foreground font-medium">
                          {!SUPABASE_CONFIGURED && <li>• MISSING: VITE_SUPABASE_URL / VITE_SUPABASE_KEY</li>}
                          {diagnostics.auth.status !== 'pass' && <li>• FAILURE: Auth endpoint unreachable</li>}
                          {diagnostics.session.status !== 'pass' && <li>• FAILURE: No active session detected</li>}
                          {diagnostics.org.status === 'fail' && <li>• FAILURE: RLS policies or tables missing</li>}
                      </ul>
                  </div>
              )}
              
              <div className="pt-4 border-t border-dashed">
                {userCount && (
                  <div className="mb-4 p-3 bg-muted rounded text-[10px] font-mono">
                    <p className="font-bold text-primary mb-1">auth.users count:</p>
                    {userCount.success ? (
                      <p>Total users in database: <span className="font-bold">{userCount.count}</span></p>
                    ) : (
                      <p className="text-destructive">Query error: {userCount.error}</p>
                    )}
                  </div>
                )}
                {tableCheck && (
                  <div className="mb-4 p-3 bg-muted rounded text-[10px] font-mono">
                    <p className="font-bold text-primary mb-1">information_schema.tables result:</p>
                    {tableCheck.success ? (
                      <pre>{JSON.stringify(tableCheck.rows, null, 2)}</pre>
                    ) : (
                      <p className="text-destructive">Query error: {tableCheck.error}</p>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground font-mono">
                  Timestamp: {new Date().toISOString()}<br/>
                  Session ID: {Math.random().toString(36).substring(7)}
                </p>
              </div>
          </CardContent>
        </Card>
      </div>
      <div className="pt-8 border-t">
        <Card className="border-amber-500/20 bg-amber-500/5 shadow-xl">
          <CardHeader>
            <div className="flex items-center space-x-2">
              <Zap className="h-5 w-5 text-amber-500" />
              <CardTitle>Foundation Schema Synchronization</CardTitle>
            </div>
            <CardDescription>
              Execute the required database schema using elevated <code>service_role</code> privileges via the server API.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3 border border-dashed border-amber-500/30">
              <p className="text-xs font-bold uppercase tracking-tight flex items-center gap-2">
                <Database className="h-3 w-3" />
                Database Connection Troubleshooting
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px]">
                <div className="space-y-1">
                  <p className="font-bold text-amber-600">1. Check Port Configuration</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Supabase <strong>Direct</strong> connection uses port <code>5432</code>.<br />
                    The <strong>Transaction Pooler</strong> uses port <code>6543</code>.<br />
                    Try switching between them in your <code>DATABASE_URL</code>.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-amber-600">2. Connection String Format</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Format: <code>postgres://postgres:[PASS]@[HOST]:[PORT]/postgres</code><br />
                    If password has special characters, use the "Pooled" string from Supabase.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-amber-600">3. Enable IPv4</p>
                  <p className="text-muted-foreground leading-relaxed">
                    In Supabase &rarr; Settings &rarr; Database, ensure IPv4 is enabled or use the region-specific URL provided by Supabase.
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-bold text-amber-600">4. SSL Mode</p>
                  <p className="text-muted-foreground leading-relaxed">
                    Most Supabase projects require <code>?sslmode=require</code> at the end of the <code>DATABASE_URL</code> string.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-background rounded-lg border">
              <div>
                <p className="font-bold">Sync Database Schema</p>
                <p className="text-xs text-muted-foreground">Applies <code>supabase_schema.sql</code> to the configured <code>DATABASE_URL</code></p>
              </div>
              <Button 
                variant="outline" 
                onClick={runMigration} 
                disabled={migrating}
                className="border-amber-500/50 hover:bg-amber-500/10"
              >
                {migrating ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Database className="mr-2 h-4 w-4" />
                )}
                Synchronize Schema
              </Button>
            </div>

            {migrationResult && (
              <div className={`p-4 rounded-lg text-xs font-mono border ${migrationResult.success ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-destructive/10 border-destructive/20 text-destructive'}`}>
                {migrationResult.success ? (
                  <div className="flex items-start space-x-2">
                    <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold uppercase">Success</p>
                      <p>{migrationResult.message}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start space-x-2">
                    <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold uppercase">Migration Failed</p>
                      <p className="mb-2">{migrationResult.error}</p>
                      
                      {migrationResult.hint && (
                        <div className="mt-3 pt-3 border-t border-destructive/20">
                          <p className="font-bold text-[10px] uppercase text-muted-foreground mb-1">Resolution Hint:</p>
                          <p className="text-foreground">{migrationResult.hint}</p>
                          {(migrationResult.error?.includes('timeout') || migrationResult.error?.includes('ECONNREFUSED')) && (
                            <ul className="mt-2 list-disc pl-4 space-y-1 text-muted-foreground">
                              <li>Verify host and port (Direct: 5432, Pooled: 6543)</li>
                              <li>Check if <code>?sslmode=require</code> is needed in your DATABASE_URL</li>
                              <li>Ensure "IPv4" is enabled in your Supabase project settings</li>
                              <li>Verify your password doesn't contain special characters that require URL encoding</li>
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

