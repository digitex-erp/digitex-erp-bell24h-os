/**
 * WhatsApp (Meta Cloud API) template mapping.
 *
 * WHY: outside Meta's 24-hour customer-service window a business may only send an APPROVED TEMPLATE. Campaigns
 * message cold contacts, so they must be template messages. Meta's template has numbered body placeholders
 * ({{1}}, {{2}} …). A Bell24h-OS template row can therefore carry a MAPPING:
 *
 *   provider_template_name       the exact name of the template as approved in Meta (lowercase, digits, underscore)
 *   provider_template_language   e.g. "en", "en_US", "hi"
 *   provider_template_variables  ORDERED list of variable names: entry 1 fills {{1}}, entry 2 fills {{2}} …
 *
 * WHAT THIS DOES NOT DO: it cannot know whether Meta approved the template — approval happens in Meta. The mapping
 * is therefore reported as UNVERIFIED until a real send with it has succeeded (the status is derived from the message
 * log, never from an operator's say-so). A failed send with an unapproved template surfaces Meta's own error.
 * Only Meta's Cloud API is used; there is no MSG91 / Twilio WhatsApp path.
 */

import { CommunicationValidationError } from "./validation.js";

export const META_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
export const META_LANGUAGE_RE = /^[a-z]{2,3}(_[A-Za-z]{2,4})?$/;
export const VARIABLE_NAME_RE = /^\w{1,50}$/;
export const MAX_TEMPLATE_PARAMS = 10;
/** Meta limit for one body parameter. */
export const META_PARAM_MAX = 1024;

/** What is stored on the message and handed to the adapter. */
export interface ProviderTemplateRef {
  name: string;
  language: string;
  parameters: string[];
}

export interface MappingFields {
  providerTemplateName?: unknown;
  providerTemplateLanguage?: unknown;
  providerTemplateVariables?: unknown;
}

export interface ValidMapping {
  name: string | null;
  language: string;
  variables: string[];
}

/**
 * Validates the mapping fields of a template. Only WhatsApp templates may carry a mapping. Reject, never strip.
 * An empty/absent name means "not mapped" (free text, only deliverable inside the 24-hour window).
 */
export function validateMapping(input: MappingFields, channelType: string): ValidMapping {
  const rawName = input.providerTemplateName;
  const hasName = rawName !== undefined && rawName !== null && rawName !== "";
  if (!hasName) {
    if (Array.isArray(input.providerTemplateVariables) && input.providerTemplateVariables.length > 0) {
      throw new CommunicationValidationError("providerTemplateVariables", "requires providerTemplateName");
    }
    return { name: null, language: "en", variables: [] };
  }
  if (channelType !== "whatsapp") throw new CommunicationValidationError("providerTemplateName", "only WhatsApp templates can map to a Meta template");
  if (typeof rawName !== "string" || !META_TEMPLATE_NAME_RE.test(rawName)) {
    throw new CommunicationValidationError("providerTemplateName", "must be the Meta template name: lowercase letters, digits and underscores");
  }
  const lang = input.providerTemplateLanguage === undefined || input.providerTemplateLanguage === "" ? "en" : input.providerTemplateLanguage;
  if (typeof lang !== "string" || !META_LANGUAGE_RE.test(lang)) throw new CommunicationValidationError("providerTemplateLanguage", "must look like en, en_US or hi");
  const vars = input.providerTemplateVariables === undefined ? [] : input.providerTemplateVariables;
  if (!Array.isArray(vars)) throw new CommunicationValidationError("providerTemplateVariables", "must be an ordered array of variable names");
  if (vars.length > MAX_TEMPLATE_PARAMS) throw new CommunicationValidationError("providerTemplateVariables", `at most ${MAX_TEMPLATE_PARAMS} parameters are supported`);
  for (const v of vars) {
    if (typeof v !== "string" || !VARIABLE_NAME_RE.test(v)) throw new CommunicationValidationError("providerTemplateVariables", "every entry must be a variable name ([A-Za-z0-9_], max 50)");
  }
  if (new Set(vars).size !== vars.length) throw new CommunicationValidationError("providerTemplateVariables", "entries must be unique");
  return { name: rawName, language: lang, variables: vars as string[] };
}

/**
 * Builds the ordered body parameters for one recipient. Every mapped variable must have a non-empty value: Meta
 * rejects empty parameters, and sending a partly-filled template would be wrong. Whitespace is collapsed because Meta
 * forbids newlines, tabs and runs of 4+ spaces inside a template parameter (this is normalization of formatting only).
 */
export function buildTemplateParameters(variableNames: readonly string[], values: Record<string, unknown> | undefined): string[] {
  return variableNames.map((name, i) => {
    const raw = values?.[name];
    if (raw === undefined || raw === null || typeof raw === "object") {
      throw new CommunicationValidationError(`variables.${name}`, `is required for WhatsApp template parameter {{${i + 1}}}`);
    }
    const v = String(raw).replace(/\s+/g, " ").trim();
    if (v === "") throw new CommunicationValidationError(`variables.${name}`, `is empty; WhatsApp template parameter {{${i + 1}}} cannot be empty`);
    if (v.length > META_PARAM_MAX) throw new CommunicationValidationError(`variables.${name}`, `is longer than ${META_PARAM_MAX} characters`);
    return v;
  });
}

/** Variables a campaign can always supply per recipient (see CampaignService.createCampaign). */
export const CAMPAIGN_RECIPIENT_VARIABLES = ["first_name", "last_name", "company"] as const;

/** Mapped variables that neither the recipient data nor the campaign-level variables can ever fill. */
export function unresolvableVariables(mapped: readonly string[], campaignVariables: Record<string, unknown> | undefined): string[] {
  const available = new Set<string>([...CAMPAIGN_RECIPIENT_VARIABLES, ...Object.keys(campaignVariables ?? {})]);
  return mapped.filter((v) => !available.has(v));
}

export type ProviderTemplateStatus = "not_mapped" | "unverified" | "verified_by_send";
/** Derived from the message log only: verified_by_send needs at least one message with this template that a provider accepted. */
export function providerTemplateStatus(mappedName: string | null, acceptedSends: number): ProviderTemplateStatus {
  if (!mappedName) return "not_mapped";
  return acceptedSends > 0 ? "verified_by_send" : "unverified";
}
