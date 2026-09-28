/**
 * Communication Hub — role-based access control (Sprint C0 / B3).
 *
 * requireAuth proves WHO the caller is and which organization they belong to.
 * It says nothing about WHAT they may do, and until now nothing in server/ read
 * the roles / user_roles tables. This module is that check for the
 * Communication Hub routes.
 *
 * Role -> permission mapping (a decision made in Sprint C0, not a pre-existing
 * convention — there was none to match; role names are the ones seeded in
 * activate_vyaparsethu_root_org.sql):
 *
 *   send   ADMIN, MANAGER                  outbound messages cost money and reach real people
 *   write  ADMIN, MANAGER, EDITOR          create/modify templates (no outbound effect by itself)
 *   read   ADMIN, MANAGER, EDITOR, VIEWER  templates, history, message status
 *
 * Fail closed: an error resolving roles denies the request; a user with no role
 * in the organization is denied.
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
