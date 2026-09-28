/** Storage of validated explanations (append-only) and organization-scoped reads. */

import type pg from "pg";
import { CommunicationValidationError } from "../communication/validation.js";
import { EXPLAIN_METHODS, EXPLAIN_SUBJECTS, type Explanation, type ExplainMethod, type ExplainSubject } from "./types.js";
import { validateExplanation } from "./validate.js";

export class ExplanationTableMissingError extends Error {
  readonly code = "explanation_table_missing";
  constructor() {
    super("public.explanation_records does not exist. Apply add_explanations.sql.");
  }
}

const isMissing = (err: unknown) => (err as { code?: string })?.code === "42P01";

/** Validates, then appends. The organization is always the caller's; an invalid explanation is never stored. */
export async function recordExplanation(pool: pg.Pool, organizationId: string, actor: string | null, input: unknown): Promise<{ id: string }> {
  const e = validateExplanation(input);
  try {
    const r = await pool.query(
      `INSERT INTO public.explanation_records (organization_id, subject_type, subject_id, method, model_id, model_version, prediction, base_value, local_fit, attributions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING id`,
      [organizationId, e.subject, e.subjectId, e.method, e.modelId, e.modelVersion, e.prediction, e.baseValue, e.localFit ?? null, JSON.stringify(e.attributions), actor],
    );
    return { id: r.rows[0].id as string };
  } catch (err) {
    if (isMissing(err)) throw new ExplanationTableMissingError();
    throw err;
  }
}

export async function listExplanations(
  pool: pg.Pool,
  organizationId: string,
  f: { subject?: unknown; subjectId?: unknown; method?: unknown; limit?: unknown },
): Promise<{ records: unknown[] }> {
  const where = ["organization_id = $1"];
  const params: unknown[] = [organizationId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.subject !== undefined && f.subject !== "") {
    if (!EXPLAIN_SUBJECTS.includes(f.subject as ExplainSubject)) throw new CommunicationValidationError("subject", `must be one of: ${EXPLAIN_SUBJECTS.join(", ")}`);
    add("subject_type = ?", f.subject);
  }
  if (f.method !== undefined && f.method !== "") {
    if (!EXPLAIN_METHODS.includes(f.method as ExplainMethod)) throw new CommunicationValidationError("method", `must be one of: ${EXPLAIN_METHODS.join(", ")}`);
    add("method = ?", f.method);
  }
  if (f.subjectId !== undefined && f.subjectId !== "") {
    if (typeof f.subjectId !== "string" || f.subjectId.length > 200) throw new CommunicationValidationError("subjectId", "must be a string of at most 200 characters");
    add("subject_id = ?", f.subjectId);
  }
  const limit = f.limit === undefined || f.limit === "" ? 50 : Number(f.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new CommunicationValidationError("limit", "must be an integer from 1 to 200");
  params.push(limit);
  try {
    const r = await pool.query(
      `SELECT id, subject_type, subject_id, method, model_id, model_version, prediction, base_value, local_fit, attributions, created_at
         FROM public.explanation_records WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params,
    );
    return { records: r.rows };
  } catch (err) {
    if (isMissing(err)) throw new ExplanationTableMissingError();
    throw err;
  }
}

