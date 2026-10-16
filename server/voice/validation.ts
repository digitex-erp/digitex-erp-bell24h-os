/**
 * Voice Studio — input validation at the API boundary. Mirrors
 * server/communication/validation.ts's shape (a dedicated error class, pure
 * validator functions, nothing that touches the database or network).
 */

export class VoiceValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "VoiceValidationError";
  }
}

const REF_RE = /^[A-Za-z0-9._:-]{4,64}$/;
const CODE_RE = /^[a-z0-9-]{2,64}$/;
// E.164-ish. Only used for Dograh dispatch, never logged/stored in full — see
// voiceDriver.ts's maskPhone().
const PHONE_RE = /^\+[1-9]\d{6,14}$/;

export function validateRef(value: unknown, field = "ref"): string {
  if (typeof value !== "string" || !REF_RE.test(value)) {
    throw new VoiceValidationError(field, `${field} must be 4-128 chars of [A-Za-z0-9._:-]`);
  }
  return value;
}

export function validateCode(value: unknown, field = "code"): string {
  if (typeof value !== "string" || !CODE_RE.test(value)) {
    throw new VoiceValidationError(field, `${field} must be a lowercase slug (letters, digits, hyphens)`);
  }
  return value;
}

export function validateContactName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new VoiceValidationError("contactName", "contactName is required (max 200 chars)");
  }
  // CRLF injection into any downstream log/transcript line.
  if (/[\r\n]/.test(value)) {
    throw new VoiceValidationError("contactName", "contactName must not contain line breaks");
  }
  return value.trim();
}

export function validatePhone(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !PHONE_RE.test(value)) {
    throw new VoiceValidationError("phone", "phone must be E.164 format, e.g. +919876543210");
  }
  return value;
}

export function validateDriverName(value: unknown): "simulated" | "dograh" {
  if (value !== "simulated" && value !== "dograh") {
    throw new VoiceValidationError("driver", 'driver must be "simulated" or "dograh"');
  }
  return value;
}

export function validateObjective(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 500) {
    throw new VoiceValidationError("objective", "objective is required (max 500 chars)");
  }
  if (/[\r\n]/.test(value)) {
    throw new VoiceValidationError("objective", "objective must not contain line breaks");
  }
  return value.trim();
}

export function validateLanguage(value: unknown): string {
  if (value === undefined || value === null) return "en-IN";
  if (typeof value !== "string" || !/^[a-z]{2}-[A-Z]{2}$/.test(value)) {
    throw new VoiceValidationError("language", 'language must look like "en-IN"');
  }
  return value;
}

// ─── Call Scripts ───────────────────────────────────────────────────────────

/**
 * Declarable template-variable names. Deliberately a closed allowlist (same
 * principle as communication_templates.variables, which declares a caller-
 * supplied list of variable names) rather than accepting any {{token}} --
 * an undeclared or misspelled variable is caught at save time, not silently
 * left unreplaced in a live script.
 */
export const ALLOWED_SCRIPT_VARIABLES = [
  "buyer_name",
  "supplier_name",
  "rfq_number",
  "product",
  "quantity",
  "target_date",
  "price",
  "agent_name",
  "company_name",
] as const;

export const SCRIPT_SECTION_FIELDS = [
  "opening",
  "verification",
  "purpose",
  "questions",
  "objections",
  "negotiation",
  "closing",
  "escalation",
  "fallback",
] as const;
export type ScriptSectionField = (typeof SCRIPT_SECTION_FIELDS)[number];

const VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const MAX_SECTION_LEN = 10_000;

export function validateScriptName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 200) {
    throw new VoiceValidationError("name", "name is required (max 200 chars)");
  }
  if (/[\r\n]/.test(value)) {
    throw new VoiceValidationError("name", "name must not contain line breaks");
  }
  return value.trim();
}

export function validateTone(value: unknown): string {
  if (value === undefined || value === null) return "professional";
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 50) {
    throw new VoiceValidationError("tone", "tone must be a short label (max 50 chars)");
  }
  if (/[\r\n]/.test(value)) {
    throw new VoiceValidationError("tone", "tone must not contain line breaks");
  }
  return value.trim();
}

export function validateScriptStatus(value: unknown): "draft" | "published" | "archived" {
  if (value !== "draft" && value !== "published" && value !== "archived") {
    throw new VoiceValidationError("status", 'status must be "draft", "published", or "archived"');
  }
  return value;
}

/** Free-form multi-line content (questions lists, opening lines) -- length-capped, not CRLF-stripped. */
export function validateScriptSection(value: unknown, field: ScriptSectionField): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new VoiceValidationError(field, `${field} must be a string`);
  }
  if (value.length > MAX_SECTION_LEN) {
    throw new VoiceValidationError(field, `${field} must be ${MAX_SECTION_LEN} characters or fewer`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new VoiceValidationError(field, `${field} must not contain control characters`);
  }
  return value;
}

export function validateDeclaredVariables(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw new VoiceValidationError("variables", "variables must be an array of variable-name strings");
  }
  const unknown = value.filter((v) => !(ALLOWED_SCRIPT_VARIABLES as readonly string[]).includes(v));
  if (unknown.length > 0) {
    throw new VoiceValidationError(
      "variables",
      `unknown variable(s): ${unknown.join(", ")}. Allowed: ${ALLOWED_SCRIPT_VARIABLES.join(", ")}`,
    );
  }
  return value;
}

function extractVariableTokens(text: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const m of text.matchAll(VARIABLE_TOKEN_RE)) found.add(m[1]);
  return [...found];
}

/**
 * Every {{token}} actually used across the section fields must be in the
 * script's own declared `variables` list -- catches a typo'd or forgotten
 * declaration at save time rather than leaving it silently unsubstituted
 * at preview/call time.
 */
export function validateVariableUsage(
  sections: Partial<Record<ScriptSectionField, string | null>>,
  declaredVariables: string[],
): void {
  const used = new Set<string>();
  for (const field of SCRIPT_SECTION_FIELDS) {
    for (const token of extractVariableTokens(sections[field] ?? null)) used.add(token);
  }
  const undeclared = [...used].filter((v) => !declaredVariables.includes(v));
  if (undeclared.length > 0) {
    throw new VoiceValidationError(
      "variables",
      `the script uses {{${undeclared.join("}}, {{")}}} but it is not declared in variables`,
    );
  }
}
