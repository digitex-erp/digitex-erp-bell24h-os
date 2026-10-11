/**
 * Communication Hub — role-based access control (Sprint C0 / B3), reconciled
 * with the Admin DB Diagnostics ADMIN role gate (main, commit 361a0f6 minimal
 * extraction).
 *
 * requireAuth proves WHO the caller is and which organization they belong to.
 * It says nothing about WHAT they may do. This module provides two separate
 * checks that both build on that fact:
 *
 *   - requirePermission() — Communication Hub routes. Permission -> role
 *     mapping (a decision made in Sprint C0, not a pre-existing convention —
 *     there was none to match; role names are the ones seeded in
 *     activate_vyaparsethu_root_org.sql):
 *
 *       send   ADMIN, MANAGER                  outbound messages cost money and reach real people
 *       write  ADMIN, MANAGER, EDITOR          create/modify templates (no outbound effect by itself)
 *       read   ADMIN, MANAGER, EDITOR, VIEWER  templates, history, message status
 *
 *   - requireAnyRole() — a generic, caller-supplied-allowlist role gate. Used
 *     by server.ts's admin diagnostic DB routes (/api/check-table,
 *     /api/check-users-count), per ADMIN_DB_MINIMAL_PATCH_EXTRACTION_REPORT.md.
 *     Kept as its own function rather than folded into requirePermission()
 *     because its allowed-roles list is caller-specified, not drawn from the
 *     Communication Hub's fixed permission map.
 *
 * Fail closed in both: an error resolving roles denies the request; a user
 * with no qualifying role in the organization is denied.
 */

import type { NextFunction, Request, RequestHandler, Response } from "express";
import type pg from "pg";
import { emitAuditEvent } from "../audit.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export type CommunicationPermission = "send" | "write" | "read";

export const ROLE_PERMISSIONS: Readonly<Record<CommunicationPermission, readonly string[]>> = {
  send: ["ADMIN", "MANAGER"],
  write: ["ADMIN", "MANAGER", "EDITOR"],
  read: ["ADMIN", "MANAGER", "EDITOR", "VIEWER"],
};

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

/** Communication Hub routes: gate by a fixed permission -> role mapping. */
export function requirePermission(getPool: () => pg.Pool, permission: CommunicationPermission): RequestHandler {
  const allowed = ROLE_PERMISSIONS[permission];

  return async function requirePermissionMiddleware(req: Request, res: Response, next: NextFunction) {
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
        metadata: { permission, code, reason, roles },
      });
      res.status(status).json({ error: code, requestId });
    };

    let roles: string[];
    try {
      roles = await getUserRoleNames(getPool(), auth.userId, auth.organizationId);
    } catch {
      return deny(503, "authorization_unavailable", "Role lookup failed.");
    }

    if (!roles.some((role) => allowed.includes(role))) {
      return deny(403, "forbidden", `Requires one of: ${allowed.join(", ")}.`, roles);
    }
    next();
  };
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
    } catch (err) {
      console.error("[rbac] role lookup failed:",
        err instanceof Error ? err.message : String(err),
        "code=", (err as any)?.code,
        "user=", auth.userId, "org=", auth.organizationId);
      return deny(503, "authorization_unavailable", "Role lookup failed.");
    }

    if (!roles.some((role) => allowedRoles.includes(role))) {
      return deny(403, "forbidden", `Requires one of: ${allowedRoles.join(", ")}.`, roles);
    }
    next();
  };
}
