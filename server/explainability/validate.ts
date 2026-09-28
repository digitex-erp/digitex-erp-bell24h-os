/**
 * Validation of an Explanation. Rejects, never repairs: an explanation that does not satisfy its method's defining
 * property is not an explanation and must not be stored or shown.
 */

import { CommunicationValidationError } from "../communication/validation.js";
import { EXPLAIN_METHODS, EXPLAIN_SUBJECTS, type Explanation, type ExplainMethod, type ExplainSubject, type FeatureAttribution, type FeatureValue } from "./types.js";

export const MAX_FEATURES = 200;
export const FEATURE_NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
export const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
export const MODEL_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,49}$/;
const MAX_ABS = 1e9;
const MAX_VALUE_STRING = 100;

/** SHAP additivity tolerance: absolute 1e-6 or 1e-4 relative to the prediction, whichever is larger. */
export function additivityTolerance(prediction: number): number {
  return Math.max(1e-6, Math.abs(prediction) * 1e-4);
}

const fail = (field: string, reason: string): never => {
  throw new CommunicationValidationError(field, reason);
};

function finite(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fail(field, "must be a finite number");
  if (Math.abs(v) > MAX_ABS) return fail(field, `must be within ±${MAX_ABS}`);
  return v;
}

function featureValue(v: unknown, field: string): FeatureValue {
  if (v === null || typeof v === "boolean") return v as FeatureValue;
  if (typeof v === "number") return finite(v, field);
  if (typeof v === "string") {
    if (v.length > MAX_VALUE_STRING) return fail(field, `must be at most ${MAX_VALUE_STRING} characters`);
    if (/[\u0000-\u001F\u007F]/.test(v)) return fail(field, "contains control characters");
    return v;
  }
  return fail(field, "must be a number, string, boolean or null");
}

export function validateExplanation(input: unknown): Explanation {
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("explanation", "must be an object");
  const e = input as Record<string, unknown>;

  if (!EXPLAIN_SUBJECTS.includes(e.subject as ExplainSubject)) fail("subject", `must be one of: ${EXPLAIN_SUBJECTS.join(", ")}`);
  if (!EXPLAIN_METHODS.includes(e.method as ExplainMethod)) fail("method", `must be one of: ${EXPLAIN_METHODS.join(", ")}`);
  const method = e.method as ExplainMethod;

  if (typeof e.subjectId !== "string" || e.subjectId.length < 1 || e.subjectId.length > 200 || /[\u0000-\u001F\u007F]/.test(e.subjectId)) fail("subjectId", "must be 1-200 characters without control characters");
  if (typeof e.modelId !== "string" || !MODEL_ID_RE.test(e.modelId)) fail("modelId", "must be lowercase letters, digits, dot, dash or underscore (max 100)");
  if (typeof e.modelVersion !== "string" || !MODEL_VERSION_RE.test(e.modelVersion)) fail("modelVersion", "must be a short version string");

  const prediction = finite(e.prediction, "prediction");
  const baseValue = finite(e.baseValue, "baseValue");

  if (!Array.isArray(e.attributions) || e.attributions.length === 0) fail("attributions", "must be a non-empty array");
  const raw = e.attributions as unknown[];
  if (raw.length > MAX_FEATURES) fail("attributions", `must contain at most ${MAX_FEATURES} features`);

  const seen = new Set<string>();
  const attributions: FeatureAttribution[] = raw.map((a, i) => {
    if (!a || typeof a !== "object") return fail(`attributions[${i}]`, "must be an object");
    const o = a as Record<string, unknown>;
    if (typeof o.feature !== "string" || !FEATURE_NAME_RE.test(o.feature)) return fail(`attributions[${i}].feature`, "must be a stable feature name (letters, digits, _ . : -)");
    if (seen.has(o.feature)) return fail(`attributions[${i}].feature`, `duplicate feature "${o.feature}"`);
    seen.add(o.feature);
    return { feature: o.feature, value: featureValue(o.value, `attributions[${i}].value`), contribution: finite(o.contribution, `attributions[${i}].contribution`) };
  });

  let localFit: number | undefined;
  if (method === "shap") {
    if (e.localFit !== undefined) fail("localFit", "is only valid for LIME");
    const sum = attributions.reduce((s, a) => s + a.contribution, 0);
    const gap = Math.abs(baseValue + sum - prediction);
    if (gap > additivityTolerance(prediction)) {
      fail("attributions", `SHAP values must add up: baseValue + Σ contributions = ${baseValue + sum}, but prediction = ${prediction} (gap ${gap})`);
    }
  } else {
    localFit = finite(e.localFit, "localFit");
    if (localFit < 0 || localFit > 1) fail("localFit", "must be between 0 and 1 (the surrogate's R²)");
  }

  return {
    subject: e.subject as ExplainSubject,
    subjectId: e.subjectId as string,
    method,
    modelId: e.modelId as string,
    modelVersion: e.modelVersion as string,
    prediction,
    baseValue,
    ...(localFit !== undefined ? { localFit } : {}),
    attributions,
  };
}
