# Next Sprint Recommendation

**Part of PS-01.** Per the sprint taxonomy constraint: an `IS-xx` sprint may not be
recommended unless Review Gate C is confirmed fully passed. It is not — Gate C.2B and
C.2C are both open, verified this session via live runtime testing (see
`PROJECT_CONTINUITY_REPORT.md` Step 1 and `OUTSTANDING_INVESTIGATIONS.md`). Per the
instructions, the correct recommendation in that situation is either Gate C completion
or `PS-02`.

## Recommendation: **Gate C Completion** (not `PS-02`, not `IS-01`)

Neither label fits, and forcing one would misrepresent the work:

- It is **not `PS-02`** (Architecture Freeze) because freezing now would ratify an
  architecture over an admittedly open data plane — and the baseline itself is
  internally contradictory across the repository's own documents (Step 0.7 of the
  continuity report: three different, disagreeing layer models exist in this repo,
  none of them the "Layer 0–6" the audit brief assumed). Freezing before that
  contradiction is resolved would freeze the wrong thing, or freeze nothing coherent.
- It is **not `IS-01`** because the sprint taxonomy reserves `IS-01` for the first
  implementation sprint *after* the architecture is frozen. This work closes a
  security gate that six of seven already-completed local commits were reaching for —
  it is a continuation of in-progress remediation, not the start of new platform
  construction.

This is consistent with `MASTER_CONTEXT/KERNEL_ARCHITECTURE.md`'s own independent
readiness scoring (27/100, "Architecture CANNOT be frozen") and its own recommended
sequence, which places exactly this work (its items C.2C, C.2B-completion, C.1J) before
any Kernel or module work begins.

### Purpose

Close the two open Review Gate C items so that (a) the 7 already-completed local
commits can be pushed without shipping a partially-secured API surface unlabeled, and
(b) Architecture Freeze planning (`PS-02`) can begin against an honestly-secured
foundation rather than one with 8 open, unauthenticated, RLS-bypassing data routes.

### Scope

**In scope:**
- Apply `requireAuth` (the existing, already-verified-working middleware) and explicit
  organization scoping to the 8 currently-open `server.ts` routes:
  `/api/check-table`, `/api/check-users-count`, `GET|POST /api/vault/documents`,
  `/api/vault/rd`, `/api/vault/timeline`, `/api/vault/phases`, `/api/vault/decisions`.
- Resolve, as an explicit decision (not a silent code change), what the Knowledge
  Vault module actually is: its schema comments describe a deliberately single-tenant
  "founder mode" feature with `USING (true)` public-read policies and no
  `organization_id` column at all. Gating the *route* with `requireAuth` does not
  make these tables tenant-safe by itself, because there is no tenant column to scope
  by. The Council needs to decide: (a) retrofit `organization_id` onto these five
  tables and scope them properly, (b) keep them intentionally single-tenant/admin-only
  and gate accordingly, or (c) remove/quarantine the feature as out-of-product debt
  inherited from a different, non-Bell24h-OS use case ("ICECRAFT," per its own AI
  prompt text). This decision changes the fix, so it must be made before (not during)
  implementation.
- Migrate the 9 pool-based (`getPool()`) handlers off direct `DATABASE_URL` access
  where a scoped Supabase-client path can serve the same need, per
  `KERNEL_ARCHITECTURE.md` §12's three-tier access-path model.
- Apply the column-level `REVOKE` on `ai_providers.api_key` and rotate every key that
  table has ever held (Gate C.2B).
- One live login verification by the project owner (Gate C.1J) — this session cannot
  perform it.

**Explicitly out of scope** (do not let this sprint expand into these):
- Any Kernel/Runtime architecture work from `KERNEL_ARCHITECTURE.md` (§§2–17) — that
  document is self-labeled "DESIGN — NOT FROZEN" and belongs to a future `PS-02`.
- Resolving the Layer 0–6 / 9-stage-pipeline / Kernel-5-tier contradiction — that is
  an ADR decision for `PS-02`, not something a security-remediation sprint should
  quietly pick a side on.
- Fixing the 8 stub services, the orphaned `IndustryDashboardPage`, or starting the
  `JobWorker` — all real findings (see `IMPLEMENTATION_STATUS.md`), all out of this
  sprint's scope. Record them; do not fix them here.
- Adding a test suite or CI — genuinely needed, but is its own decision (`RISK_REGISTER.md`
  R-004 and `KERNEL_ARCHITECTURE.md` recommendation #6 both place it *after* this
  gate, not inside it).

### Deliverables

- All 13 `server.ts` routes correctly gated (either `requireAuth`, or an explicit,
  documented, deliberate public-access decision for the Vault tables per the Council
  decision above) — with the same live-curl verification method this audit used
  (anonymous request → expect 401, not a 500 that merely proves "no `DATABASE_URL`
  locally").
- `ai_providers.api_key` column REVOKEd; provider keys rotated.
- A recorded live-login result (pass or the exact failure) from the project owner.
- The 7 currently-unpushed commits pushed to `origin/main`, plus whatever new commits
  this sprint produces.
- An updated Review Gate C record showing PASS with evidence per item, per the
  constitution's evidence discipline (HTTP response evidence preferred over code
  inspection, exactly as this audit practiced).

### Dependencies and prerequisites

- Needs the Council decision on Vault-table tenancy before the route-gating work can
  be finished (not before it can start — the other 3 non-Vault routes can be fixed
  immediately).
- Needs project-owner access for the live login test and the Vercel/Supabase
  dashboard checks already logged as open in `OUTSTANDING_INVESTIGATIONS.md`.
- Does not need a Vercel deployment — Gate C work can and should be verified locally
  first, exactly as this audit did.

### Risks

- **Scope creep into Kernel design** is the most likely failure mode, given how much
  detailed Kernel architecture already exists in the untracked design doc — it is
  tempting to "just also start the Kernel while we're in here." Resist this; the
  constitution's own rule is that a failed/open gate blocks the next sprint's work,
  not that it invites parallel work.
- **The Vault-tenancy decision could be skipped rather than decided**, resulting in a
  route-level `requireAuth` gate slapped onto tables that still have no tenant column
  — which would look closed in a route-level test but leave a cross-tenant read
  possible for any authenticated user of any organization. This is exactly the kind
  of "fabricated pass" the constitution warns against; do not let "the route now
  returns 401 for anonymous callers" be mistaken for "the data is tenant-isolated."
- **In-memory rate limiting and AI budget counters** (already flagged in
  `KERNEL_ARCHITECTURE.md` §7.3 and §10) will produce incorrect behavior the moment a
  second server instance exists — not a blocker for this sprint's single-instance
  scope, but should not be forgotten when deployment is eventually planned.

### Definition of Done

Per the constitution: code merged, tests passing (none currently exist — if this
sprint adds gating logic, it should add at least route-level auth tests, matching
`CODE_STANDARDS.md`'s own stated requirement that new work include tests), docs
updated (this report set, plus an updated Gate C record), Review Gate C passed with
runtime evidence per item (not code inspection alone), and production readiness
status updated to reflect the new state honestly — including if the honest state is
still "not production ready" pending the still-open Authentication and Vercel-env-var
investigations logged in `OUTSTANDING_INVESTIGATIONS.md`.

---

## If evidence does not support proceeding

It does, for the route-gating and key-rotation work — that is well-scoped, and this
audit found no missing prerequisite for starting it (`requireAuth` already exists and
is already verified working; it is a matter of applying it to 8 more registrations).

The one piece that is **not** ready to start is the Vault-tenancy decision, which
needs a human Council judgment call (retrofit / restrict / remove), not more
investigation — the facts needed to make that decision are already in this report.
