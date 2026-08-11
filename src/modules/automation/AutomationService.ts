import { supabase } from "@/lib/supabase";
import { getCurrentOrganizationId } from "@/lib/currentOrganization";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'paused' | 'draft';
  created_at: string;
}

export interface WorkflowHistory {
  id: string;
  workflow_id: string;
  status: 'started' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  error_message?: string;
}

export class AutomationService {
  private static instance: AutomationService;

  public static getInstance(): AutomationService {
    if (!AutomationService.instance) {
      AutomationService.instance = new AutomationService();
    }
    return AutomationService.instance;
  }

  // BR-03 P0: `automation_workflows.organization_id` is enforced by RLS
  // ("Org isolation select/insert/update", supabase_schema.sql) regardless of this
  // filter, so a missing filter here was not itself cross-tenant-exploitable. This
  // `.eq()` is added as defense-in-depth — it can only narrow what RLS already returns,
  // never widen it — and, more importantly, resolving organization_id here is what makes
  // createWorkflow() below able to satisfy RLS's INSERT check at all (see that method).
  async getWorkflows(): Promise<Workflow[]> {
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error("No authenticated organization context");

    const { data, error } = await supabase
      .from('automation_workflows')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // BR-03: `workflow_history` has no organization_id column of its own — it is a child
  // table, scoped via its parent `automation_workflows.organization_id` through RLS's
  // "Org isolation select" EXISTS-subquery policy (supabase_schema.sql). There is no
  // column here to add an application-level `.eq()` filter against without either a
  // schema change (out of scope) or duplicating the RLS subquery in application code
  // (unnecessary complexity for a table RLS already correctly scopes). Left unchanged;
  // documented rather than force-fit — see BR-03-SECURITY-REMEDIATION-REPORT.md §4.
  async getWorkflowHistory(limit = 10): Promise<WorkflowHistory[]> {
    const { data, error } = await supabase
      .from('workflow_history')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  // BR-03 P0 fix: this INSERT previously never set organization_id — the Workflow
  // interface didn't even carry the field. RLS's "Org isolation insert" policy requires
  // `organization_id = get_current_org_id()`, so with organization_id absent (NULL) the
  // insert would fail that check for every caller, regardless of organization. This was
  // a functional defect (the feature could never successfully write), not a leak — fixed
  // by resolving the trusted organization_id server-side-of-RLS (from the authenticated
  // session, never from caller input) and including it in the payload.
  async createWorkflow(workflow: Omit<Workflow, 'id' | 'created_at'>): Promise<Workflow> {
    const organizationId = await getCurrentOrganizationId();
    if (!organizationId) throw new Error("No authenticated organization context");

    const { data, error } = await supabase
      .from('automation_workflows')
      .insert([{ ...workflow, organization_id: organizationId }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async triggerWorkflow(workflowId: string): Promise<string> {
    // In a real system, this would queue a job in the background
    // For now, we simulate the start of an execution
    //
    // BR-03: no organization_id column exists on workflow_history to set or check here.
    // RLS's "Org isolation insert" policy for this table verifies, via its own
    // EXISTS-subquery, that `workflowId` belongs to a workflow the caller's organization
    // owns — so a cross-organization workflowId is rejected by RLS regardless of what
    // this method does. That guarantee depends on automation_workflows rows actually
    // carrying the correct organization_id, which createWorkflow() above now ensures.
    const { data, error } = await supabase
      .from('workflow_history')
      .insert([{
        workflow_id: workflowId,
        status: 'started',
        started_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) throw error;
    return data.id;
  }
}
