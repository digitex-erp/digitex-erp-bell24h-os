/**
 * Explainer registry. EMPTY BY DEFAULT — that is the truthful state today. `explain()` fails closed with a typed error
 * when nothing is registered, and even a registered explainer's output is validated before it is returned, so an
 * explainer cannot smuggle back an explanation that breaks its own method's definition.
 */

import { EXPLAIN_METHODS, EXPLAIN_SUBJECTS, type ExplainMethod, type ExplainRequest, type Explanation, type ExplainerAdapter, type ExplainSubject } from "./types.js";
import { validateExplanation } from "./validate.js";

export class ExplainerNotRegisteredError extends Error {
  readonly code = "explainer_not_implemented";
  constructor(
    public readonly subject: ExplainSubject,
    public readonly method: ExplainMethod,
  ) {
    super(`No ${method.toUpperCase()} explainer is registered for "${subject}". The explainability framework is in place, but no scorer or explainer exists yet.`);
  }
}

export class ExplainerMismatchError extends Error {
  readonly code = "explainer_mismatch";
}

export class ExplainerRegistry {
  private adapters = new Map<string, ExplainerAdapter>();
  private key = (s: ExplainSubject, m: ExplainMethod) => `${s}:${m}`;

  register(adapter: ExplainerAdapter): void {
    if (!EXPLAIN_SUBJECTS.includes(adapter.subject) || !EXPLAIN_METHODS.includes(adapter.method)) throw new Error("Unknown explainer subject or method.");
    if (!adapter.description || adapter.description.trim().length < 10) throw new Error("An explainer must describe honestly what it explains (description ≥ 10 characters).");
    const k = this.key(adapter.subject, adapter.method);
    if (this.adapters.has(k)) throw new Error(`An explainer is already registered for ${k}.`);
    this.adapters.set(k, adapter);
  }

  unregister(subject: ExplainSubject, method: ExplainMethod): void {
    this.adapters.delete(this.key(subject, method));
  }

  get(subject: ExplainSubject, method: ExplainMethod): ExplainerAdapter {
    const a = this.adapters.get(this.key(subject, method));
    if (!a) throw new ExplainerNotRegisteredError(subject, method);
    return a;
  }

  async explain(request: ExplainRequest): Promise<Explanation> {
    const adapter = this.get(request.subject, request.method);
    const out = validateExplanation(await adapter.explain(request));
    if (out.subject !== request.subject || out.method !== request.method || out.subjectId !== request.subjectId) {
      throw new ExplainerMismatchError("The explainer returned an explanation for a different subject, id or method than requested.");
    }
    return out;
  }

  /** What is actually available. `implemented` is derived from registrations, never asserted. */
  status() {
    const matrix = EXPLAIN_SUBJECTS.map((subject) => ({
      subject,
      methods: EXPLAIN_METHODS.map((method) => {
        const a = this.adapters.get(this.key(subject, method));
        return a ? { method, state: "registered" as const, description: a.description } : { method, state: "not_implemented" as const };
      }),
    }));
    const registered = matrix.reduce((n, m) => n + m.methods.filter((x) => x.state === "registered").length, 0);
    return {
      state: registered === 0 ? ("framework_only" as const) : ("partial" as const),
      registered,
      matrix,
      note: "Contracts, validation and storage exist. A method is only available where an explainer has been registered against a real scorer; none is registered by default.",
    };
  }
}

/** The process-wide registry. Nothing registers into it in this repository yet. */
export const explainerRegistry = new ExplainerRegistry();
