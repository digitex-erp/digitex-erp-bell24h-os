import { supabase } from "@/lib/supabase";

export class AdminService {
  static async getUsers() {
    // Requires SUPABASE_SERVICE_KEY for real admin operations
    // Placeholder returning empty for now
    return [];
  }

  static async getAuditLogs() {
    // Placeholder
    return [];
  }

  static async getSystemHealth() {
    // BELL24H_OS_EXECUTION_BACKLOG.md TASK-06 (GOV-2): this previously returned a
    // hardcoded "healthy"/42-node result with no backing check at all — the
    // source of the same fictional "42 instances" figure the Dashboard also
    // showed. No microservice/worker-node health checks exist anywhere in this
    // repository to report a real result from, so this now says so explicitly
    // instead of fabricating a pass. Unused by any caller today (confirmed by
    // repo-wide search) — kept for API compatibility rather than removed.
    return {
      status: "not_implemented" as const,
      detail: "No infrastructure health checks exist for this repository to report.",
    };
  }
}
