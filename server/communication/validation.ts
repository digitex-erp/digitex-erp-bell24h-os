/**
 * Communication Hub — input validation and sanitization (Sprint C0 / B2).
 *
 * Every value that ends up inside a wire protocol (SMTP commands and headers,
 * provider API bodies) is validated here. The policy is REJECT, never
 * "strip and continue": silently rewriting a recipient or subject can deliver
 * a message to an address the caller did not name.
 *
 * Applied at three layers so no single layer is load-bearing: the HTTP route
 * (400 for the caller), CommunicationService (before anything is stored), and
 * the provider adapters themselves (before anything touches a socket).
 */

import type { ChannelType } from "./types.js";

export class CommunicationValidationError extends Error {
  readonly code = "validation_failed";
  constructor(
    public readonly field: string,
    reason: string,
  ) {
    super(`${field}: ${reason}`);
  }
}

/** Channels with an approved provider in the current strategy (email, SMS via MSG91, WhatsApp via Meta). */
export const SENDABLE_CHANNELS: readonly ChannelType[] = ["email", "sms", "whatsapp"];

// C0 control characters (incl. CR, LF, NUL, ESC), DEL, and the Unicode line/paragraph separators.
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u2028\u2029]/;

const MAX_EMAIL_LENGTH = 254; // RFC 5321 path limit
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 100_000;

// Conservative addr-spec: dot-atom local part, LDH domain labels, at least one dot. Deliberately rejects
// quoted local parts, IP literals and comments — none are needed here and each widens the injection surface.
const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

const E164_RE = /^\+[1-9]\d{6,14}$/;

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new CommunicationValidationError(field, "must be a string");
  return value;
}

/** Rejects any control character, including CR / LF / NUL. */
export function assertNoControlChars(value: string, field: string): void {
  if (CONTROL_CHARS.test(value)) {
    throw new CommunicationValidationError(field, "contains control characters (CR/LF/NUL are not allowed)");
  }
}

export function validateEmailAddress(value: unknown, field = "recipient"): string {
  const v = requireString(value, field);
  assertNoControlChars(v, field);
  if (v.length === 0 || v.length > MAX_EMAIL_LENGTH) {
    throw new CommunicationValidationError(field, `must be 1-${MAX_EMAIL_LENGTH} characters`);
  }
  if (!EMAIL_RE.test(v)) throw new CommunicationValidationError(field, "is not a valid email address");
  // Belt and braces on top of the regex: none of these may ever appear in an SMTP path.
  if (/[<>\s,;"\\]/.test(v)) throw new CommunicationValidationError(field, "contains forbidden characters");
  return v;
}

export function validatePhoneNumber(value: unknown, field = "recipient"): string {
  const v = requireString(value, field);
  assertNoControlChars(v, field);
  if (!E164_RE.test(v)) throw new CommunicationValidationError(field, "must be an E.164 number, e.g. +919876543210");
  return v;
}

export function validateRecipient(channel: ChannelType, value: unknown): string {
  return channel === "email" ? validateEmailAddress(value) : validatePhoneNumber(value);
}

export function validateChannel(value: unknown): ChannelType {
  if (typeof value !== "string" || !(SENDABLE_CHANNELS as readonly string[]).includes(value)) {
    throw new CommunicationValidationError("channelType", `must be one of: ${SENDABLE_CHANNELS.join(", ")}`);
  }
  return value as ChannelType;
}

/** A subject becomes an SMTP header value, so line breaks would let a caller add headers (Bcc:, etc.). */
export function validateSubject(value: unknown, field = "subject"): string | null {
  if (value === undefined || value === null) return null;
  const v = requireString(value, field);
  assertNoControlChars(v, field);
  if (v.length > MAX_SUBJECT_LENGTH) throw new CommunicationValidationError(field, `must be at most ${MAX_SUBJECT_LENGTH} characters`);
  return v;
}

export function validateBody(value: unknown, field = "body"): string {
  const v = requireString(value, field);
  if (v.length === 0) throw new CommunicationValidationError(field, "must not be empty");
  if (v.length > MAX_BODY_LENGTH) throw new CommunicationValidationError(field, `must be at most ${MAX_BODY_LENGTH} characters`);
  if (v.includes("\u0000")) throw new CommunicationValidationError(field, "contains NUL");
  return v;
}

export function validateIdempotencyKey(value: unknown): string {
  const v = requireString(value, "Idempotency-Key");
  if (!IDEMPOTENCY_KEY_RE.test(v)) {
    throw new CommunicationValidationError("Idempotency-Key", "must be 8-128 characters of [A-Za-z0-9._:-]");
  }
  return v;
}

export function validateSmtpHost(value: unknown): string {
  const v = requireString(value, "settings.host");
  if (!HOSTNAME_RE.test(v)) throw new CommunicationValidationError("settings.host", "is not a valid hostname");
  return v;
}

export function validateSmtpPort(value: unknown): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new CommunicationValidationError("settings.port", "must be an integer between 1 and 65535");
  }
  return n;
}

/**
 * RFC 2047 encoding for header values that contain non-ASCII text, so the wire
 * form stays 7-bit. Input must already have passed assertNoControlChars.
 */
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/**
 * Normalizes every line ending in a message body to CRLF. A bare CR or bare LF
 * that reaches the wire is treated as a line terminator by some MTAs and not
 * others, which is the basis of SMTP smuggling (a "\n.\n" sequence ending DATA early).
 */
export function normalizeToCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\r\n");
}
