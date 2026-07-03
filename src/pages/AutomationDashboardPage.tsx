import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutomationService, Workflow, WorkflowHistory } from "@/modules/automation/AutomationService";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Play, Plus, Activity, CheckCircle, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

export function AutomationDashboardPage() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [history, setHistory] = useState<WorkflowHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [w, h] = await Promise.all([
          AutomationService.getInstance().getWorkflows(),
          AutomationService.getInstance().getWorkflowHistory()
        ]);
        setWorkflows(w);
        setHistory(h);
      } catch (error) {
        console.error("Failed to fetch automation data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleTrigger = async (id: string) => {
    try {
      await AutomationService.getInstance().triggerWorkflow(id);
      const h = await AutomationService.getInstance().getWorkflowHistory();
      setHistory(h);
    } catch (error) {
      console.error("Failed to trigger workflow:", error);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Automation Platform</h1>
          <p className="text-muted-foreground">Autonomous execution engine for Bell24h-OS</p>
        </div>
        <Button asChild>
          <Link to="/automation/builder">
            <Plus className="mr-2 h-4 w-4" /> Create Workflow
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workflows.filter(w => w.status === 'active').length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Executions</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{history.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {history.length > 0 
                ? `${Math.round((history.filter(h => h.status === 'completed').length / history.length) * 100)}%`
                : '100%'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed Items</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{history.filter(h => h.status === 'failed').length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workflows.map((workflow) => (
                  <TableRow key={workflow.id}>
                    <TableCell className="font-medium">{workflow.name}</TableCell>
                    <TableCell>
                      <Badge variant={workflow.status === 'active' ? 'default' : 'secondary'}>
                        {workflow.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleTrigger(workflow.id)}>
                        <Play className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {workflows.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No workflows found. Create your first automation.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workflow</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium">
                      {workflows.find(w => w.id === h.workflow_id)?.name || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={h.status === 'completed' ? 'outline' : h.status === 'failed' ? 'destructive' : 'default'}>
                        {h.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(h.started_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {history.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                      No execution history yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
