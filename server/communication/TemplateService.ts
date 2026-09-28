/**
 * TemplateService — editing and (de)activating message templates.
 *
 * A template is what a campaign renders at send time, and a campaign is only allowed to run after a TEST
 * of that content succeeded. So a template that any unfinished campaign (draft / scheduled / running /
 * paused) still uses is LOCKED against content changes and deactivation: otherwise the message that goes
 * out could differ from the one that was tested, or every remaining recipient could fail mid-run.
 */

import type pg from "pg";
import { emitAuditEvent, newRequestId } from "../audit.js";
import { CommunicationValidationError, validateBody, validateSubject, validateUuid } from "./validation.js";

export class TemplateNotFoundError extends Error {
  constructor() {
    super("Template not found in this organization.");
  }
}

export class TemplateInUseError extends Error {
  readonly code = "template_in_use";
  constructor(public readonly campaigns: number) {
    super(`Template is used by ${campaigns} unfinished campaign(s); finish or cancel them before changing its content or deactivating it. (Renaming is always allowed.)`);
  }
}

export class TemplateService {
  constructor(private pool: pg.Pool) {}

  async update(organizationId: string, actor: string, templateId: string, patch: Record<string, unknown>) {
    const id = validateUuid(templateId, "templateId");
    const allowed = ["name", "subject", "body", "isActive"];
    for (const k of Object.keys(patch)) if (!allowed.includes(k)) throw new CommunicationValidationError(k, "cannot be changed here");
    if (Object.keys(patch).length === 0) throw new CommunicationValidationError("body", "provide at least one of name, subject, body, isActive");

    const existing = await this.pool.query(`SELECT id FROM public.communication_templates WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
    if (existing.rows.length === 0) throw new TemplateNotFoundError();

    const sets: string[] = [];
    const params: unknown[] = [id, organizationId];
    const set = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };

    let contentChange = false;
    if (patch.name !== undefined) {
      if (typeof patch.name !== "string" || patch.name.trim() === "" || patch.name.length > 200) throw new CommunicationValidationError("name", "is required (max 200 characters)");
      set("name", patch.name.trim());
    }
    if (patch.subject !== undefined) {
      set("subject", validateSubject(patch.subject));
      contentChange = true;
    }
    if (patch.body !== undefined) {
      set("body", validateBody(patch.body));
      contentChange = true;
    }
    if (patch.isActive !== undefined) {
      if (typeof patch.isActive !== "boolean") throw new CommunicationValidationError("isActive", "must be true or false");
      set("is_active", patch.isActive);
      if (patch.isActive === false) contentChange = true;
    }

    if (contentChange) {
      const used = await this.pool.query(
        `SELECT COUNT(*)::int AS n FROM public.communication_campaigns WHERE organization_id = $1 AND template_id = $2 AND status IN ('draft','scheduled','running','paused')`,
        [organizationId, id],
      );
      if ((used.rows[0].n as number) > 0) throw new TemplateInUseError(used.rows[0].n);
    }

    const r = await this.pool.query(
      `UPDATE public.communication_templates SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING *`,
      params,
    );
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.template.updated",
      targetType: "communication_template",
      targetId: id,
      outcome: "success",
      requestId: newRequestId(),
      metadata: { fields: Object.keys(patch) }, // field names only, never content
    });
    return r.rows[0];
  }
}
