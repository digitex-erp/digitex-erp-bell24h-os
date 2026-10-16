/**
 * Voice Studio — role-based access control.
 *
 * Reuses getUserRoleNames() from server/communication/rbac.ts (the exact
 * same user_roles/roles lookup Communication Hub already uses) rather than
 * reimplementing role resolution a second time. Only the permission-to-role
 * mapping below is Voice-specific.
 *
 *   dispatch  ADMIN, MANAGER                  places/simulates an outbound call — costs money with a real driver
 *   write     ADMIN, MANAGER, EDITOR          create/modify agents, campaigns, scripts (no outbound effect by itself)
 *   read      ADMIN, MANAGER, EDITOR, VIEWER  calls, history, transcripts, config
 *
 * Fails closed: an error resolving roles denies the request; a user with no
 * qualifying role in the organization is denied.
 */

import type { NextFunction, Request, Response } from "express";
import type pg from "pg";
import { emitAuditEvent } from "../audit.js";
import { getUserRoleNames } from "../communication/rbac.js";
import type { AuthedRequest } from "../middleware/requireAuth.js";

export type VoicePermission = "dispatch" | "write" | "read";

export const VOICE_ROLE_PERMISSIONS: Readonly<Record<VoicePermission, readonly string[]>> = {
  dispatch: ["ADMIN", "MANAGER"],
  write: ["ADMIN", "MANAGER", "EDITOR"],
  read: ["ADMIN", "MANAGER", "EDITOR", "VIEWER"],
};

export function requireVoicePermission(getPool: () => pg.Pool, permission: VoicePermission) {
  const allowed = VOICE_ROLE_PERMISSIONS[permission];

  return async function requireVoicePermissionMiddleware(req: Request, res: Response, next: NextFunction) {
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
        action: "voice.authorize",
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
