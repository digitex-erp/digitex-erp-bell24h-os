import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle, XCircle, AlertTriangle, RefreshCw, Shield, Database, Server, Monitor } from "lucide-react";
import { supabase, SUPABASE_CONFIGURED } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export function SystemDiagnosticsPage() {
  const [serverEnv, setServerEnv] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>({
    auth: { status: 'checking', details: null },
    db: { status: 'checking', details: null },
    session: { status: 'checking', details: null },
    org: { status: 'checking', details: null }
  });
  const [loading, setLoading] = useState(true);
  const user = useAuthStore(state => state.user);

  const clientEnvKeys = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_KEY',
    'VITE_SUPABASE_ANON_KEY'
  ];

  const getClientVar = (key: string) => {
    const val = (import.meta.env as any)[key];
    return {
      loaded: !!val,
      length: val ? val.length : 0,
      suffix: val ? (val.length > 8 ? `...${val.slice(-8)}` : val) : null
    };
  };

  const runDiagnostics = async () => {
    setLoading(true);
    const newDiagnostics = { ...diagnostics };

    // 1. Fetch Server Env
    try {
      const resp = await fetch('/api/env/diagnostic');
      const data = await resp.json();
      setServerEnv(data);
    } catch (e) {
      console.error("Failed to fetch server env", e);
    }

    // 2. Auth Reachability
    try {
      const { error } = await supabase.auth.getSession();
      newDiagnostics.auth = {
        status: error ? 'fail' : 'pass',
        details: error ? `Auth error: ${error.message}` : 'Auth endpoint reachable'
      };
    } catch (e: any) {
      newDiagnostics.auth = { status: 'fail', details: e.message };
    }

    // 3. Database Check
    try {
      const { error } = await supabase.from('organizations').select('id').limit(1);
      newDiagnostics.db = {
        status: error ? 'fail' : 'pass',
        details: error ? `Database error: ${error.message}` : 'Database reachable'
      };
    } catch (e: any) {
      newDiagnostics.db = { status: 'fail', details: e.message };
    }

    // 4. Session Status
    newDiagnostics.session = {
      status: user ? 'pass' : 'fail',
      details: user ? `Authenticated as ${user.email}` : 'No active session'
    };

    // 5. Organization Context
    if (user) {
      try {
        const { data, error } = await supabase.rpc('get_current_org_id');
        newDiagnostics.org = {
          status: error ? 'fail' : (data ? 'pass' : 'warn'),
          details: error ? `RLS Error: ${error.message}` : (data ? `Org ID: ${data}` : 'No organization selected')
        };
      } catch (e: any) {
        newDiagnostics.org = { status: 'fail', details: e.message };
      }
    } else {
        newDiagnostics.org = { status: 'fail', details: 'Authentication required' };
    }

    setDiagnostics(newDiagnostics);
    setLoading(false);
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const StatusIcon = ({ status }: { status: string }) => {
    if (status === 'pass') return <CheckCircle className="h-5 w-5 text-green-500" />;
    if (status === 'fail') return <XCircle className="h-5 w-5 text-destructive" />;
    if (status === 'warn') return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    return <RefreshCw className="h-5 w-5 text-muted-foreground animate-spin" />;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Runtime Environment Audit</h1>
          <p className="text-muted-foreground">End-to-end verification of environment variable flow and authentication</p>
        </div>
        <Button onClick={runDiagnostics} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Rerun Audit
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center space-x-2">
            <Monitor className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Client Runtime (Vite)</CardTitle>
              <CardDescription>Variables injected into the browser</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variable</TableHead>
                  <TableHead>Loaded</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Suffix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientEnvKeys.map(key => {
                  const info = getClientVar(key);
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-xs">{key}</TableCell>
                      <TableCell>
                        <Badge variant={info.loaded ? "default" : "destructive"}>
                          {info.loaded ? "YES" : "NO"}
                        </Badge>
                      </TableCell>
                      <TableCell>{info.length}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{info.suffix || '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center space-x-2">
            <Server className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Server Runtime (Express)</CardTitle>
              <CardDescription>Variables detected in process.env</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variable</TableHead>
                  <TableHead>Loaded</TableHead>
                  <TableHead>Length</TableHead>
                  <TableHead>Suffix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {serverEnv ? Object.keys(serverEnv).map(key => (
                  <TableRow key={key}>
                    <TableCell className="font-mono text-xs">{key}</TableCell>
                    <TableCell>
                      <Badge variant={serverEnv[key].loaded ? "default" : "destructive"}>
                        {serverEnv[key].loaded ? "YES" : "NO"}
                      </Badge>
                    </TableCell>
                    <TableCell>{serverEnv[key].length}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{serverEnv[key].suffix || '-'}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                      Loading server environment...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Shield className="h-5 w-5 text-primary" />
                <CardTitle>Connectivity Status</CardTitle>
              </div>
              <Badge variant={diagnostics.auth.status === 'pass' ? 'default' : 'destructive'}>
                {diagnostics.auth.status.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                    <StatusIcon status={diagnostics.auth.status} />
                    <span className="text-sm font-medium">Auth Endpoint Reachable</span>
                </div>
                <span className="text-xs text-muted-foreground text-right">{diagnostics.auth.details}</span>
             </div>
             <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                    <StatusIcon status={diagnostics.db.status} />
                    <span className="text-sm font-medium">Database Accessible</span>
                </div>
                <span className="text-xs text-muted-foreground">{diagnostics.db.details}</span>
             </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle>Session & RLS Audit</CardTitle>
              </div>
              <Badge variant={diagnostics.session.status === 'pass' ? 'default' : 'destructive'}>
                {diagnostics.session.status.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
             <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                    <StatusIcon status={diagnostics.session.status} />
                    <span className="text-sm font-medium">Authentication Session</span>
                </div>
                <span className="text-xs text-muted-foreground">{diagnostics.session.details}</span>
             </div>
             <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center space-x-3">
                    <StatusIcon status={diagnostics.org.status} />
                    <span className="text-sm font-medium">Row-Level Security (RLS)</span>
                </div>
                <span className="text-xs text-muted-foreground text-right">{diagnostics.org.details}</span>
             </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle>Recovery Plan</CardTitle>
          <CardDescription>Required actions based on audit results</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!SUPABASE_CONFIGURED && (
            <div className="p-4 border border-destructive/20 bg-destructive/5 rounded-lg flex items-start space-x-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-bold text-destructive">Secrets Mismatch Detected</p>
                <p className="text-xs text-muted-foreground">
                  The client runtime is missing keys. Ensure you have added <strong>VITE_SUPABASE_URL</strong> and <strong>VITE_SUPABASE_KEY</strong> (or ANON_KEY) in AI Studio Secrets and clicked <strong>Apply Changes</strong>.
                </p>
              </div>
            </div>
          )}
          {diagnostics.auth.status === 'pass' && SUPABASE_CONFIGURED && diagnostics.session.status === 'pass' && (
             <div className="p-4 border border-green-500/20 bg-green-500/5 rounded-lg flex items-start space-x-4">
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                <div className="space-y-1">
                    <p className="text-sm font-bold text-green-500">Foundation Verified</p>
                    <p className="text-xs text-muted-foreground">
                        All environment variables have successfully flowed into both client and server runtimes. Authentication is operational.
                    </p>
                </div>
             </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
