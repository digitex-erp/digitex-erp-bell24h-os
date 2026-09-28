/**
 * Explainability framework — CONTRACTS ONLY (Phase 2, priority 5).
 *
 * This layer defines what an explanation of a scoring/ranking decision must look like, how one is validated, where it
 * is stored and how an explainer is plugged in. It contains NO predictive model and NO explainer: nothing in this
 * repository produces a SHAP or LIME value today. Until a real scorer and a real explainer are registered, asking for
 * an explanation fails with "not implemented" — it never returns a made-up one.
 *
 * Subjects it is prepared for (their scorers do not exist yet and are separate sprints):
 *   rfq_matching · supplier_ranking · trust_infrastructure · trade_confidence_score
 *
 * Definitions used by the validators:
 *   SHAP  additive attribution: baseValue + Σ contribution(feature) = prediction  (local accuracy / efficiency).
 *   LIME  local surrogate: per-feature weights of a locally fitted linear model, plus `intercept` and `localFit`
 *         (the surrogate's R² on the perturbation sample, 0..1). LIME weights need NOT sum to the prediction.
 */

export const EXPLAIN_SUBJECTS = ["rfq_matching", "supplier_ranking", "trust_infrastructure", "trade_confidence_score"] as const;
export type ExplainSubject = (typeof EXPLAIN_SUBJECTS)[number];

export const EXPLAIN_METHODS = ["shap", "lime"] as const;
export type ExplainMethod = (typeof EXPLAIN_METHODS)[number];

export type FeatureValue = number | string | boolean | null;

export interface FeatureAttribution {
  /** Stable feature name, e.g. "category_match" or "on_time_delivery_rate". */
  feature: string;
  /** The input value the model saw for this feature (already de-identified; no names, phones or emails). */
  value: FeatureValue;
  /** Signed contribution to the score. Positive raised it, negative lowered it. */
  contribution: number;
}

export interface Explanation {
  subject: ExplainSubject;
  /** Id of the thing explained (e.g. a match or ranking row id). Opaque to this layer. */
  subjectId: string;
  method: ExplainMethod;
  /** Identifies the scorer that was explained. */
  modelId: string;
  modelVersion: string;
  /** The score being explained. */
  prediction: number;
  /** SHAP: the expected model output over the background data. LIME: the surrogate's intercept. */
  baseValue: number;
  /** LIME only: surrogate R² in [0, 1]. Required for LIME, forbidden for SHAP. */
  localFit?: number;
  attributions: FeatureAttribution[];
}

export interface ExplainRequest {
  organizationId: string;
  subject: ExplainSubject;
  subjectId: string;
  method: ExplainMethod;
  /** De-identified feature values the scorer used. */
  features: Record<string, FeatureValue>;
}

/** What a real explainer implements. Registered per (subject, method). */
export interface ExplainerAdapter {
  readonly subject: ExplainSubject;
  readonly method: ExplainMethod;
  /** Human-readable, honest description of the explainer, e.g. "TreeSHAP over model rfq-matcher@3". */
  readonly description: string;
  explain(request: ExplainRequest): Promise<Explanation>;
}
