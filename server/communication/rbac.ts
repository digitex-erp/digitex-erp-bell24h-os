/**
 * Admin DB Diagnostics — ADMIN role gate.
 *
 * requireAuth proves WHO the caller is and which organization they belong to.
 * It says nothing about WHAT they may do. This is that check for the admin
 * diagnostic DB routes in server.ts (/api/check-table, /api/check-users-count).
 *
 * Fail closed: an error resolving roles denies the request; a user with no role
 * in the organization is denied.
 *
 * MINIMAL EXTRACTION NOTE: this file is a deliberately trimmed subset of
 * server/communication/rbac.ts as it exists on sprint/ch-02-campaigns (commit
 * 361a0f6). That version also exports `CommunicationPermission`,
 * `ROLE_PERMISSIONS`, and `requirePermission()` — a permission-name mapping
 * (manage/send/write/read) used only by the Communication Hub's own routes,
 * which are not part of this patch. Only `getUserRoleNames()` and
 * `requireAnyRole()` — the two things the diagnostics routes actually call —
 * are reproduced here, per ADMIN_DB_MINIMAL_PATCH_EXTRACTION_REPORT.md.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { emitAuditEvent } from "../audit.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export async function getUserRoleNames(pool: pg.Pool, userId: string, organizationId: string): Promise<string[]> {
  const res = await pool.query(
    `SELECT DISTINCT UPPER(r.name) AS name
       FROM public.user_roles ur
       JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1
        AND ur.organization_id = $2
        AND (r.organization_id IS NULL OR r.organization_id = $2)
        AND r.deleted_at IS NULL`,
    [userId, organizationId],
  );
  return res.rows.map((row: { name: string }) => row.name);
}

/**
 * Generic role gate: allows the request only if the caller holds ANY of `allowedRoles` in their
 * organization. Must run after requireAuth.
 */
export function requireAnyRole(getPool: () => pg.Pool, allowedRoles: readonly string[], label: string): RequestHandler {
  return async function requireAnyRoleMiddleware(req: Request, res: Response, next: NextFunction) {
    const { auth, requestId } = req as AuthedRequest;
    if (!auth) {
      // Middleware order is wrong (requireAuth must run first). Fail closed.
      res.status(500).json({ error: "authorization_misconfigured" });
      return;
    }

    const deny = (status: number, code: string, reason: string, roles?: string[]) => {
      emitAuditEvent({
        actor: auth.userId,
        organizationId: auth.organizationId,
        action: "communication.authorize",
        targetType: "http_request",
        targetId: `${req.method} ${req.path}`,
        outcome: "denied",
        requestId: requestId ?? "unknown",
        metadata: { permission: label, code, reason, roles },
      });
      res.status(status).json({ error: code, requestId });
    };

    let roles: string[];
    try {
      roles = await getUserRoleNames(getPool(), auth.userId, auth.organizationId);
    } catch {
      return deny(503, "authorization_unavailable", "Role lookup failed.");
    }

    if (!roles.some((role) => allowedRoles.includes(role))) {
      return deny(403, "forbidden", `Requires one of: ${allowedRoles.join(", ")}.`, roles);
    }
    next();
  };
}
