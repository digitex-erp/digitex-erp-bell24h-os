---
name: bell24h-constitution
description: Review Gate discipline and Definition of Done for Bell24h-OS. Use when running or closing a sprint, certifying a Review Gate, deciding whether work is complete, judging whether something counts as evidence, or when a prerequisite is missing and you are tempted to work around it. Read before reporting any blocker as resolved.
---

# Bell24h-OS Review Gate discipline

`ENGINEERING_GOVERNANCE.md` is the authoritative constitution; this skill is how to
apply it. Where they disagree, the document wins.

## Evidence, not inference

Code inspection does not close a blocker. Neither does a passing build, on its own.

| Claim | Insufficient | Sufficient |
|---|---|---|
| "Endpoint requires auth" | route handler reads a token | unauthenticated `curl` returns 401/403 |
| "Bypass excluded from prod" | `import.meta.env.DEV` guard is present | markers absent from `dist/assets/*.js` **and** prod runtime redirects to `/auth` |
| "Env var reaches the client" | it is set in the dashboard | the value appears in the built bundle or at runtime |
| "RLS protects this table" | a policy exists in the schema | a query as another tenant returns no rows |
| "Feature works" | UI renders | the backend action ran and persisted |

Prefer the strongest evidence available: HTTP response > runtime state > build output >
source. State which one you used. If you only have source-level evidence, say so
explicitly and mark the item unverified rather than passed.

Never write "should work", "appears correct", or "presumably passes" into a gate result.
Either it was observed or it was not.

## Missing prerequisites are blockers, not detours

When credentials, access, or environment are unavailable:

1. **Stop that item.** Do not substitute a proxy for the real check.
2. Name the exact missing thing — which credential, which permission, which value.
3. State who can supply it and the smallest action that unblocks it.
4. **Finish every item that does not depend on it**, then report.

Do not infer a result in either direction. "Cannot verify" is a legitimate, useful gate
outcome. A fabricated pass is not, and a fabricated fail is not either.

If a prescribed remedy turns out to rest on a false premise, say so before implementing
it. Executing a fix you know is wrong is worse than pausing to flag it.

## Definition of Done

A change is done only when implementation, tests, documentation, observability,
authorization, error handling, and review evidence are all complete.

> A UI that renders without a verified backend action is not complete.

Specifically, for anything touching data or identity:
- authorization enforced **server-side**, not only in the UI
- organization scope applied to every query
- audit event emitted for sensitive mutations
- errors surfaced, not swallowed
- the happy path demonstrated at runtime, not asserted

## Scope control

Work stays inside the approved sprint. New features, framework additions, schema
duplication, broad refactors, and unrelated cleanup all require explicit approval.

When you notice a real problem outside scope: **record it, do not fix it.** Report it in
the deliverables with severity and evidence. Fixing it silently makes the diff
unreviewable and hides the finding.

Every modified file must appear in the final report with: why it changed, what changed,
and which gate requirement it satisfies.

## Gate outcomes

Produce exactly one verdict: **PASS** or **BLOCKED**.

PASS requires every criterion to be a genuine, evidenced pass. One unverified item means
BLOCKED — not "conditional pass", not "pass with notes".

When BLOCKED, list every blocking issue ordered by severity, each with the exact action
required to unblock it. Distinguish issues that need a human (credentials, access,
decisions) from issues that are just work.

A failed gate blocks the next sprint. Do not begin the next sprint's work, and do not
recommend it, until the gate passes.

## Reporting honestly

- Report what happened, including what you skipped and why.
- If a previous turn's conclusion was wrong, correct it plainly and move on.
- Do not restate a claim as verified when it was only asserted earlier in the session.
- Distinguish "I observed this" from "the user told me this" from "the docs say this".
- Keep provenance accurate in commit messages — the message must match the diff.

## Security findings outrank sprint scope

If you find a live credential exposure, an unauthenticated privileged endpoint, or a
tenant-isolation break, report it immediately and prominently even if it is out of
scope — but still do not fix it without approval. Severity determines urgency of
*reporting*, not licence to expand the diff.
