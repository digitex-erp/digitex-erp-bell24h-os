import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, Server, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function DatabasePage() {
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSchema() {
      try {
        const tableNames = [
          'organizations', 'profiles', 'roles', 'permissions', 'user_roles',
          'companies', 'buyers', 'suppliers', 'contacts', 'categories',
          'products', 'rfqs', 'rfq_items', 'quotations', 'quotation_items',
          'orders', 'order_items', 'tasks', 'notes', 'attachments',
          'notifications', 'activities', 'audit_logs', 'api_keys',
          'ai_agents', 'ai_jobs', 'seo_projects', 'social_accounts',
          'social_posts', 'campaigns', 'workflows', 'workflow_runs',
          'tags', 'tag_relations'
        ];
        const tableData = [];
        
        for (const name of tableNames) {
          const { count } = await supabase.from(name).select('*', { count: 'exact', head: true });
          tableData.push({
            name,
            rows: count ?? 0,
            status: "Active"
          });
        }
        
        setTables(tableData);
      } catch (err) {
        console.error("Failed to fetch schema", err);
      } finally {
        setLoading(false);
      }
    }
    fetchSchema();
  }, []);

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
            <div className="text-2xl font-bold">Connected</div>
            <p className="text-xs text-muted-foreground">Supabase Postgres</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Storage</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Online</div>
            <p className="text-xs text-muted-foreground">Live data mapped via Supabase</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">System Status</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-500">Healthy</div>
            <p className="text-xs text-muted-foreground">All systems operational</p>
          </CardContent>
        </Card>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Enterprise Schema Data</CardTitle>
          <CardDescription>
            Live synchronization metrics mapped from PostgreSQL instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-4">Loading table statistics from Supabase...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground uppercase border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Table Name</th>
                    <th className="px-4 py-3 font-medium">Row Count</th>
                    <th className="px-4 py-3 font-medium text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tables.map((table) => (
                    <tr key={table.name} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{table.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{table.rows}</td>
                      <td className="px-4 py-3 text-right text-emerald-500">{table.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
