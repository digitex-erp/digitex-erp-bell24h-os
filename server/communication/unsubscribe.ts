/**
 * One-click unsubscribe for email campaigns.
 *
 * A suppression list only works if recipients can actually opt out. Every campaign email carries a signed
 * link ({{unsubscribe_url}} in the body, plus RFC 8058 List-Unsubscribe / List-Unsubscribe-Post headers).
 *
 * The link contains no database id and no secret: a token = base64url(JSON{org, channel, address}) + "." +
 * base64url(HMAC-SHA256(secret, payload)). Anyone holding the link can unsubscribe THAT address in THAT
 * organization and nothing else; nobody can forge one without COMM_UNSUBSCRIBE_SECRET. Tokens do not expire
 * (an unsubscribe link must keep working).
 *
 * Fail closed: without COMM_UNSUBSCRIBE_SECRET and COMM_PUBLIC_BASE_URL no link can be built, and email
 * campaigns refuse to be scheduled or executed.
 */

import crypto from "node:crypto";
import type { ChannelType } from "./types.js";

export interface UnsubscribeConfig {
  secret: string;
  /** Public origin of this API, e.g. https://os.example.com (no trailing slash, https in production). */
  baseUrl: string;
}

export interface UnsubscribeClaims {
  organizationId: string;
  channel: ChannelType;
  address: string;
}

type Env = Record<string, string | undefined>;

export function getUnsubscribeConfig(env: Env = process.env): UnsubscribeConfig | null {
  const secret = env.COMM_UNSUBSCRIBE_SECRET;
  const base = env.COMM_PUBLIC_BASE_URL;
  if (!secret || secret.length < 16 || !base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return { secret, baseUrl: `${url.protocol}//${url.host}` };
}

const b64 = (buf: Buffer) => buf.toString("base64url");

export function signUnsubscribeToken(claims: UnsubscribeClaims, secret: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ o: claims.organizationId, c: claims.channel, a: claims.address, v: 1 }), "utf8"));
  const mac = b64(crypto.createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${mac}`;
}

export function verifyUnsubscribeToken(token: unknown, secret: string): UnsubscribeClaims | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const expected = crypto.createHmac("sha256", secret).update(parts[0]).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { o?: unknown; c?: unknown; a?: unknown; v?: unknown };
    if (p.v !== 1 || typeof p.o !== "string" || typeof p.a !== "string" || (p.c !== "email" && p.c !== "sms" && p.c !== "whatsapp")) return null;
    return { organizationId: p.o, channel: p.c, address: p.a };
  } catch {
    return null;
  }
}

export function buildUnsubscribeUrl(cfg: UnsubscribeConfig, claims: UnsubscribeClaims): string {
  return `${cfg.baseUrl}/api/communications/unsubscribe?t=${signUnsubscribeToken(claims, cfg.secret)}`;
}
