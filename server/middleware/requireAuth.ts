/**
 * Supabase JWT verification + organization context resolution.
 *
 * Governance: ENGINEERING_GOVERNANCE.md — "Fail closed when identity, organization,
 * or authorization cannot be resolved." Every failure path in this module denies the
 * request; there is no branch that allows an unverified caller through.
 *
 * Organization lookup deliberately uses the CALLER'S token (not a service-role key)
 * so Supabase RLS applies to the profile read.
 */

import type { NextFunction, Request, Response } from "express";
import { emitAuditEvent, newRequestId } from "../audit";

export interface AuthContext {
  userId: string;
  organizationId: string;
  token: string;
}

export interface AuthedRequest extends Request {
  auth?: AuthContext;
  requestId?: string;
}

function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.VITE_SUPABASE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url: url.replace(/\/+$/, ""), anonKey };
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Express middleware. On success attaches `req.auth` and calls next().
 * On any failure it terminates the request — it never calls next().
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authedReq = req as AuthedRequest;
  const requestId = newRequestId();
  authedReq.requestId = requestId;

  const deny = (status: number, code: string, reason: string) => {
    emitAuditEvent({
      actor: null,
      organizationId: null,
      action: "auth.verify",
      targetType: "http_request",
      targetId: `${req.method} ${req.path}`,
      outcome: "denied",
      requestId,
      metadata: { code, reason, status },
    });
    res.status(status).json({ error: code, requestId });
  };

  // Token presence is checked before server configuration so that an anonymous
  // caller always receives 401 and never learns anything about server config state.
  const token = bearerToken(req);
  if (!token) {
    return deny(401, "unauthenticated", "Missing or malformed Authorization bearer token.");
  }

  const config = supabaseConfig();
  if (!config) {
    // Fail closed: without a verifier we cannot establish identity, so deny.
    return deny(
      503,
      "auth_unavailable",
      "Supabase server configuration missing (SUPABASE_URL / SUPABASE_ANON_KEY).",
    );
  }

  let userId: string;
  try {
    const userRes = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) {
      return deny(401, "invalid_token", `Token rejected by Supabase (${userRes.status}).`);
    }
    const user = (await userRes.json()) as { id?: string };
    if (!user?.id) {
      return deny(401, "invalid_token", "Supabase returned no user id.");
    }
    userId = user.id;
  } catch {
    return deny(503, "auth_unavailable", "Could not reach Supabase to verify the token.");
  }

  let organizationId: string;
  try {
    const profileRes = await fetch(
      `${config.url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=organization_id`,
      { headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` } },
    );
    if (!profileRes.ok) {
      return deny(403, "organization_unresolved", `Profile lookup failed (${profileRes.status}).`);
    }
    const rows = (await profileRes.json()) as Array<{ organization_id?: string | null }>;
    const orgId = rows?.[0]?.organization_id;
    if (!orgId) {
      return deny(403, "no_organization", "Authenticated user has no organization context.");
    }
    organizationId = orgId;
  } catch {
    return deny(503, "auth_unavailable", "Could not reach Supabase to resolve organization.");
  }

  authedReq.auth = { userId, organizationId, token };
  next();
}
