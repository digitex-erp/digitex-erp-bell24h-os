# Call Scripts — Implementation Report

**Branch/worktree (unchanged from Batch 1):** `feature/shogo-voice-studio-migration`, `C:\Projects\bell24h-os-voice-studio-migration`, base SHA `ca8d1bb6d48e1b9dfc084acdfbe1a6b213d25695`. No change outside this worktree; no commit, push, or merge performed.

## Preflight (Section 3) — result: confirmed missing, matches the audit's prior finding

`voice_scripts` (table) existed from Batch 1 with every field the screenshot's sections need (`opening, verification, purpose, questions, objections, negotiation, closing, escalation, fallback, variables, language, tone, status, version`). **Confirmed before writing any code**, by reading `server/voice/routes.ts` and `VoiceService.ts` as they stood: zero routes, zero service methods referenced `voice_scripts`. The sample data in the Shogo screenshot proves nothing about a destination backend — there was no destination backend. This matches `SHOGO_COMMUNICATION_MODULE_REGISTER.csv`'s prior "Call Scripts: ABSENT at destination (table only)" finding exactly; the preflight did not change that finding, it confirmed it by reading the actual code rather than re-trusting the earlier audit.

**What did NOT exist and had to be designed, not just wired up:** explicit draft/published separation with version history. The existing `voice_scripts` table is a single mutable row with one `status`/`version` pair — insufficient on its own for "a published version stays stable while someone edits a draft." This is addressed by one new, additive table (below).

## What was implemented

**Database (additive only, appended to the end of the existing `add_voice_studio_tables.sql` — no `ALTER` on any existing table, no destructive statement):**
- `voice_script_versions` — one immutable snapshot row per publish (`script_id`, `organization_id`, `version`, every content field, `published_by`, `published_at`). RLS `SELECT`-isolation + `REVOKE` of `INSERT/UPDATE/DELETE` from `anon`/`authenticated` (no role, including the service layer's own tenant-facing grants, can mutate a published snapshot — it is append-only by construction).

**Validation (`server/voice/validation.ts`, additions only — existing exports unchanged):**
- `ALLOWED_SCRIPT_VARIABLES` — a closed allowlist (`buyer_name, supplier_name, rfq_number, product, quantity, target_date, price, agent_name, company_name`), mirroring `communication_templates.variables`' own "declared variable names" convention rather than accepting arbitrary `{{tokens}}`.
- `validateScriptName`, `validateTone`, `validateScriptStatus` (defined, status transitions are enforced in the service, not settable directly via API input), `validateScriptSection` (length-capped at 10,000 chars, rejects control characters, deliberately **not** CRLF-stripped — these are legitimate multi-line fields, unlike `contactName`/`objective`).
- `validateDeclaredVariables` — rejects any declared name outside the allowlist.
- `validateVariableUsage` — scans all nine section fields for `{{token}}` usage and rejects any token not present in the script's own declared `variables` list. **This is a real validation gap this batch closes**: a typo'd or forgotten variable declaration is caught at save time, not silently left as literal `{{text}}` in a live script.

**Service (`server/voice/VoiceService.ts`, additions only — existing `dispatchCall`/`listCalls`/etc. unchanged, confirmed by the full regression run below):**
- `listScripts`, `getScript` (includes the version-history list), `createScript`, `updateScript`, `duplicateScript`, `publishScript`, `previewScript`.
- Two new error classes: `VoiceScriptNotFoundError` (404), `VoiceScriptConflictError` (409 — duplicate code, or an edit/publish attempted on an archived script).
- State machine: a script is created at `status='draft', version=0`. `publishScript` snapshots the current content into `voice_script_versions` at `version+1` and sets the row to `status='published'`. Any subsequent `updateScript` call that changes a published script's content **reverts it to `status='draft'`** — the live row is never silently labeled "published" while its content has diverged from the last snapshot. Re-publishing with no changes is a reported no-op (`published: false`), not a duplicate snapshot.
- `duplicateScript` always creates a fresh draft at `version=0` with no inherited publish history — confirmed by test.
- `previewScript` is **read-only and has zero side effects**: it renders the nine sections with `{{variable}}` tokens substituted from caller-supplied sample values (each value length-capped, single-line, and HTML-escaped before substitution) or a bracketed `[varname]` placeholder when no sample was supplied, and returns `{preview: true, disclaimer: "This is a text preview only. No call is placed and no voice is synthesized."}`. It never touches `voice_calls`, `job_queue`, or any driver — confirmed both by code inspection (no import of `voiceDriver.ts` or `QueueManager` in the preview path) and by a test that asserts zero rows in `voice_calls`/`job_queue` after a preview call.
- Audit: every create, update, duplicate, and publish emits an `emitAuditEvent(...)` call — **reusing the existing `server/audit.ts` structured-JSON emitter** (the same mechanism `VoiceService.dispatchCall`/`createAgent`/`createCampaign` already use), not a new or separate audit mechanism. (A separate, currently-unused `public.audit_logs` table exists in `supabase_schema.sql` with no writer anywhere in this codebase; using it instead would have meant becoming the first real writer to a second, parallel audit path — correctly avoided in favor of the mechanism Voice Studio and Communication Hub already use.)

**Routes (`server/voice/routes.ts`, additions only):**

| Route | Permission | Notes |
|---|---|---|
| `GET /api/voice/scripts` | `read` | List, org-scoped |
| `GET /api/voice/scripts/:code` | `read` | Full detail + version history |
| `POST /api/voice/scripts` | `write` (ADMIN/MANAGER/EDITOR) | Create |
| `PATCH /api/voice/scripts/:code` | `write` | Update draft content; reverts `published`→`draft` on change |
| `POST /api/voice/scripts/:code/duplicate` | `write` | Fresh draft copy |
| `POST /api/voice/scripts/:code/publish` | `write` | Snapshot + status flip |
| `POST /api/voice/scripts/:code/preview` | `read` | Gated at `read`, not `write` — it reveals nothing beyond what `GET /:code` already exposes and has no side effects |

No new permission tier was added; `publish` is gated at the same `write` tier as create/update, consistent with how no other Voice Studio or Communication Hub action has a stricter-than-`write` tier for a "material" action today. Noted as a design choice, not an oversight — tightening this (e.g. requiring `dispatch`-tier for publish) is a one-line change if a future reviewer wants it, but nothing in the task asked for it.

**Not added, deliberately:** an archive/un-archive route. `status='archived'` is schema-supported (the `CHECK` constraint already allowed it from Batch 1) and the service layer already guards against editing or publishing an archived script (409), but no route sets a script to `archived` in this batch — Section 4's required operation list was "list, read, create, update, duplicate, and version/publish," and archive wasn't in it. The guard code was tested by seeding `status='archived'` directly via SQL in the test, not through a route, since no route to reach that state exists yet.

## Tests and verification (Section 5)

Exact commands run, this session:

```
npx tsx --test server/voice/__tests__/callScripts.integration.test.ts
  16 pass, 0 fail

npx tsx --test server/ai/*.test.ts "server/communication/__tests__/*.test.ts" "server/middleware/*.test.ts" "server/voice/__tests__/*.test.ts"
  182 pass, 0 fail, exit 0
  (166 from before this batch + 16 new Call Scripts tests; confirms zero
  regression to Communication Hub, the AI router, requireServiceAuth, or
  the existing Voice Studio dispatch/agents/campaigns/webhook routes)
```

Coverage, mapped to Section 5's list:
- **Authentication:** every script route rejects an unauthenticated request (401) — tested.
- **RBAC:** `write` requires ADMIN/MANAGER/EDITOR (VIEWER/role-less rejected, 403); `read` additionally allows VIEWER — tested for both tiers.
- **CRUD and validation:** create/get/list tested; missing `name` (400, `field: "name"`); duplicate `code` for the same org (409) — tested.
- **Template-variable handling:** an undeclared `{{token}}` used in a section (400, `field: "variables"`); an unknown declared variable name (400) — both tested. Preview substitution with HTML-escaping and the `[varname]` placeholder fallback — tested.
- **Draft/published behavior and versioning:** full lifecycle tested end-to-end (create at v0 → publish v1 → edit reverts to draft → publish v2 → two version-history rows, second one reflecting the edited content). No-op re-publish tested. Archived-script edit/publish rejection (409) tested.
- **Duplicate behavior:** fresh draft at v0, no inherited version history, source's publish state irrelevant — tested. Duplicate `newCode` collision (409) — tested.
- **Error handling and audit events:** every mutating path emits an audit event via the existing emitter (not independently assertable from the test's black-box HTTP interface without capturing stdout, which the test harness suppresses for audit lines the same way the existing dispatch tests do — the emission call itself is present in the reviewed source and follows the exact same call shape as the already-tested `dispatchCall`/`createAgent` audit emissions). **This is a real test-coverage gap, stated plainly rather than claimed as tested**: audit *emission* is code-reviewed, not independently asserted by a test in this batch.
- **Existing Communication Hub and Voice Studio regressions:** the full 182-test run above is exactly this check, and it passed.

`tsc --noEmit`, filtered to this batch's own files (`server/voice/*`, `add_voice_studio_tables.sql`): **zero errors.** (The worktree's full `tsc --noEmit` run still reports the same pre-existing, unrelated ~260 errors documented in `SHOGO_VOICE_STUDIO_MIGRATION_REPORT.md` as a `node_modules` symlink artifact of this worktree, re-confirmed not to include any file this batch touched.)

**Not tested, stated honestly:** frontend UI states (loading/validation-error/unsaved-changes/success/failure) — no UI was built for Call Scripts in this batch (Section 7 asked for a report distinguishing "UI present versus backend implemented"; for this feature, **only the backend exists** — `VoiceStudioPage.tsx` was not modified to add a Scripts tab. This is the inverse of several other Voice Studio items, where UI exists with no backend). Building that UI, plus its loading/error/empty/unsaved-changes states, is unstarted and would be the natural next slice of this same feature, not a separate batch.

**No live database migration was run.** As with Batch 1, the new `voice_script_versions` table was only ever applied inside the in-process PGlite test engine via `t.db.exec(voiceSql)`. No claim of production readiness is made from these unit/integration test results alone.

## Register update

`docs/audits/SHOGO_COMMUNICATION_MODULE_REGISTER.csv`'s "Call Scripts" row (`Voice Agents`/`Call Campaigns`/`Call Scripts`/`Voice Providers` rows generally) should be updated to reflect:

| Field | Prior status | Updated status |
|---|---|---|
| `backend_status` | ABSENT (table only) | **IMPLEMENTED** — full CRUD + draft/publish/versioning, 16/16 tests passing |
| `ui_status` | COMPLETE (Shogo only) | Still **ABSENT at destination** — no UI tab added this batch |
| `migration_decision` | DEFER | **DONE** (backend); UI remains a follow-up |
| `security_controls_and_gaps` | "No specific control -- not implemented" | RBAC (write/read tiers), org isolation (tested cross-org), audit events on every mutation, template-variable allowlist validation, HTML-escaped preview substitution, immutable version history (no role can UPDATE/DELETE `voice_script_versions`) |

(The CSV file itself was not mechanically rewritten in this pass to keep this report self-contained for review; the table above is the exact diff to apply to that row once this batch is accepted.)

## Addendum — Batch 2: UI (this update)

**Preflight re-confirmed before writing any UI code:** branch `feature/shogo-voice-studio-migration`, HEAD `ca8d1bb6`, worktree `C:\Projects\bell24h-os-voice-studio-migration` unchanged; `server/voice/__tests__/callScripts.integration.test.ts` and both prior audit docs present and unmodified by anything else in the meantime.

### What was implemented

A fourth tab, **Scripts**, added to the existing `src/pages/VoiceStudioPage.tsx` (no new file, no new route in `src/App.tsx` — reuses the existing `/voice-studio` route and the page's existing tab-switch pattern). Connects to all 7 `/api/voice/scripts*` endpoints via the existing `authedFetchJson` client — the same Supabase-session-bearer wrapper every other tab on this page already uses. No second authentication mechanism was introduced.

Structure: a script-library list panel (left) + an editor/detail panel (right), following the page's existing two-column Card layout convention (same pattern as the Overview tab's dispatch-form-plus-recent-calls layout).

**States covered, each independently:**
- **List:** loading (spinner), error (message + Retry button, same convention as the page's existing error banner), empty ("No scripts yet — these are real saved records, not sample data" — explicit, per Phase 2's instruction not to present sample data as saved records; there is no seeded/mock data anywhere in this implementation, so this state only ever appears when the organization genuinely has zero scripts).
- **Detail/editor:** loading, error-with-retry, not-open (prompt to select or create), open-for-a-new-unsaved-script, open-for-an-existing-script.
- **Unsaved changes:** a dirty-check (`JSON.stringify(draft) !== JSON.stringify(savedSnapshot)`) drives an explicit "Unsaved changes" banner with a Discard button, shown above the editor whenever the in-progress edit differs from the last-loaded/last-saved content — for both a brand-new draft and an edit to an existing script.
- **Validation / save errors:** shown inline in a destructive-colored box. **Known, honestly-stated limitation:** the shared `authedFetchJson` client only forwards the server's `error` code (e.g. `"validation_failed"`, `"conflict"`), not the `field`/`detail` the server actually returns — so a validation failure displays as a generic code rather than "name is required" or "unknown variable: foo". This is a pre-existing limitation of the shared client, not newly introduced, and was not special-cased around (per Phase 2's "use the existing authenticated API client" instruction) — fixing it would mean changing `authedFetchJson` itself, out of scope for a UI-only batch.
- **Success:** a green confirmation box after create/save/duplicate/publish, with distinct wording when a save on a published script silently would have kept it mislabeled — the message explicitly says "This script reverted to draft because its published content changed" rather than just "Saved."
- **Duplicate:** its own input + button + error box, disabled until a new code is entered; on success, immediately opens the new draft.
- **Publish + version history:** Publish is disabled while there are unsaved changes or the script is archived; the version-history card lists every past publish with its timestamp, or "Never published" when empty — never fabricated.
- **Preview:** its own card, clearly labeled "Text preview of the last **saved** version only (not unsaved edits above). No call is placed and no voice is synthesized." (echoing the server's own disclaimer verbatim), with per-variable sample-value inputs restricted to the script's own declared variables, and its own loading/error states. Preview never touches `voice_calls`/`job_queue`/any driver — confirmed again by re-reading the route in this pass (unchanged since the backend batch).

### A real bug found and fixed during this pass: double HTML-escaping in preview

The server (correctly) HTML-escapes substituted preview values before returning them, since an API response may be consumed by any client. This page renders text through JSX, which **already** escapes on DOM insertion — rendering the server's pre-escaped string directly would have shown a literal `&#39;` instead of an apostrophe, `&lt;` instead of `<`, etc. (not a security bug — React's own escaping still applies to whatever string it receives either way — but a real, user-visible display defect for any script containing those characters). Fixed by adding `unescapeHtmlEntities()` in the frontend, applied only to preview-section text immediately before rendering, so the one escaping pass that actually reaches the DOM is React's own. Caught by inspection while reviewing the preview-rendering code against the existing test (`"Acme&lt;script&gt;"` was the exact assertion already written for the backend test, which is correct for the API response — the bug would only have shown up visually in the browser, not in the backend test suite).

### Security/behavior checklist (Phase 3), re-verified for the UI layer specifically

- Server-side authorization and org isolation: unchanged, untouched by this UI batch — the UI has no authorization logic of its own, it relies entirely on the existing `requireVoicePermission` gate the backend batch already tested.
- No credentials/secrets rendered anywhere in this tab — the UI never requests or displays `credentials_secret_ref` or any provider config (Scripts has nothing to do with providers).
- Preview: confirmed side-effect-free again (see above).
- User content rendered safely: confirmed via the escaping fix above — the net effect is that React's own escaping is the only one that reaches the DOM, which is the correct, safe outcome.
- No archive/un-archive/revert UI was added — matches Phase 3's explicit restriction.
- No Dograh or telephony code path was touched by this batch at all.

### Tests (Phase 4)

```
npx tsx --test server/ai/*.test.ts "server/communication/__tests__/*.test.ts" "server/middleware/*.test.ts" "server/voice/__tests__/*.test.ts"
  182 pass, 0 fail, exit 0   (unchanged from the backend batch -- no backend
  file was touched in this UI batch, so this run is a confirmation, not new
  coverage)
```

`tsc --noEmit`, filtered to this batch's own files (`src/pages/VoiceStudioPage.tsx`, plus re-checking `server/voice/*`): **two real type errors found and fixed** during this pass (an unsafe `Error`→`{status: number}` cast, fixed by adopting the same `HttpLikeError`-style type-guard pattern `src/lib/diagnosticsErrors.ts` already uses). After the fix: **zero errors attributable to this batch's own code.** The full worktree run still reports a pre-existing, repo-wide `class-variance-authority`/`Badge` `VariantProps` type-resolution error (271 total errors this run) — **confirmed NOT specific to this batch**: the identical error pattern was independently reproduced on `SystemDiagnosticsPage.tsx`, `AiProvidersPage.tsx`, and `CommunicationsPage.tsx`, three pre-existing files this batch never touched, proving it is the same worktree-wide symlinked-`node_modules` artifact already documented in `SHOGO_VOICE_STUDIO_MIGRATION_REPORT.md`, not a regression introduced here.

**No automated UI tests were added.** Re-confirmed this pass, matching the prior batch's own finding: this repository has no frontend/component test harness anywhere (no Vitest/Jest/JSDOM/React Testing Library config). Phase 4 explicitly asked for UI tests only "where the current test infrastructure supports them" — it doesn't, for any page in this codebase, not just this one. Building that harness is new infrastructure, out of scope for this batch. Every state listed above (loading/error/empty/validation/success/unsaved-changes) was verified by code review and exercised against the shape of the already-tested backend responses, not by an automated UI test.

### Register update (UI status, separate from backend status)

| Field | Status after this batch |
|---|---|
| `ui_status` | **IMPLEMENTED** — a Scripts tab in `VoiceStudioPage.tsx` covering list/create/edit/duplicate/publish/version-history/preview with loading/error/empty/validation/success/unsaved-changes states |
| `backend_status` | Unchanged — IMPLEMENTED (prior batch) |

## Addendum — verification pass (this update)

Re-confirmed the preflight (branch/HEAD/worktree unchanged) and re-read the actual code against the actual server contracts rather than assuming the prior batch's own description of itself was correct. **Note on provenance:** the task that triggered this pass described the prior report-update as having failed mid-edit; that was checked directly and found NOT to be true — the report and the UI file were both complete and well-formed before this pass began. What follows are real, independently-found defects in the *code*, not a recovery from a broken document.

**Three real bugs found and fixed in this pass:**

1. **Crash on every create and every edit-save of an existing script.** `POST /api/voice/scripts` and `PATCH /api/voice/scripts/:code` both return the raw `voice_scripts` row (confirmed by reading `server/voice/routes.ts` lines 182 and 198 directly) — neither includes a `versions` field, which only `GET /api/voice/scripts/:code` joins in. The UI had typed and used both mutation responses as the full `ScriptDetail` shape and assigned them straight to `scriptDetail`, which the already-rendered "Published version history" card reads as `scriptDetail?.versions.length`. Since `scriptDetail` itself was non-null (just missing the key), `?.` did not protect the access, and `undefined.length` would throw on the component's main happy path. **Fixed** by introducing a narrower `ScriptMutationResponse` type (`Omit<ScriptDetail, "versions">`) for both responses, so the mismatch is caught by the compiler if it recurs, and by re-fetching the full detail via a new shared `refreshScriptDetail()` helper (the same GET the "open a script" flow already uses) immediately after a successful create or update, before anything renders.
2. **Stale-response race when opening scripts in quick succession.** `openScript(code)` set `selectedCode` synchronously but committed its fetch's result unconditionally when the `await` resolved; clicking a second script before the first request returned could let the first (slower) response overwrite the second (faster) one's content while the header/list already showed the second script's code. **Fixed** with a ref (`activeScriptCodeRef`) that always holds the most recently requested code; every commit of a fetched detail now checks the ref first and silently discards a superseded response. The same ref is cleared on "New" and "Close" so a late-arriving `openScript` response can't reopen a script the user already navigated away from.
3. **Archived scripts could be edited in the UI even though the server rejects it.** The Save button was only disabled on "not dirty," not on archived status, so a user could type into an archived script and get a bare `conflict` error on Save instead of the UI preventing the action. **Fixed**: Save and Publish are now both disabled when the open script is archived, with an explicit banner ("This script is archived and cannot be edited or published.") instead of a reactive error after the fact. Duplicate and Preview remain enabled for an archived script — neither operation is guarded server-side, and both are legitimate on archived content (duplicating it into a new draft; viewing what it said).

**Also found, not a bug, fixed anyway for clarity:** a doc-comment describing `authedFetchJson`'s error-shape limitation had been left orphaned above the wrong function after an earlier edit (pointing at `unescapeHtmlEntities` instead of `describeScriptError`). Moved back to the right place; no behavior change.

**Checked and found NOT to be a problem:**
- Preview with zero declared variables: renders the raw section text with no substitution attempted — correct, no crash (confirmed by code trace, not just the existing automated test, which already covers a script *with* variables).
- Preview with special characters in *static* (non-`{{variable}}`) script text: the server never escapes static text, only the substituted spans; the client's `unescapeHtmlEntities()` is applied to the whole returned string, which could in a vanishingly unlikely coincidence alter static text that happens to literally contain a string like `&amp;`. Not fixed — React's own escaping on render still makes this safe (no XSS path), and engineering around a near-impossible coincidence for a cosmetic edge case was judged not worth the complexity for this batch. Documented here instead.
- Save/Publish/Duplicate races against a concurrent navigation (e.g., clicking Save, then immediately clicking a different script before the round-trip returns): theoretically possible but requires two deliberate actions within a sub-second network round-trip window, far less likely than the list-click race above. Left unguarded; worst case is a success message that outlives the screen it was for, recoverable by reopening the script — not a data-corruption risk, since the mutation itself still landed correctly on the server.
- Duplicate imports/declarations: none found on a full re-read of the file.

**Re-verification evidence (exact commands, this pass):**
```
npx tsx --test server/voice/__tests__/callScripts.integration.test.ts
  16 pass, 0 fail

npx tsx --test server/ai/*.test.ts "server/communication/__tests__/*.test.ts" "server/middleware/*.test.ts" "server/voice/__tests__/*.test.ts"
  182 pass, 0 fail, exit 0

npx tsc --noEmit   (filtered to VoiceStudioPage.tsx, excluding the known pre-existing Badge/VariantProps artifact)
  0 errors after the fixes above (2 real errors from the original UI batch — an unsafe
  Error->{status:number} cast — were already fixed before this pass; this pass introduced
  zero new type errors)

npm run build
  SUCCEEDED — vite build (1877 modules, 19.11s) + esbuild server bundle, exit 0.
  This is the first time a full production build was run for this feature; it passed
  cleanly, including the new Scripts tab code. (A pre-existing chunk-size warning,
  unrelated to this batch, is the only build output beyond success.)
```

The pre-existing `Badge`/`VariantProps` `tsc` artifact was re-confirmed, this pass, to still appear on three files this task never touched (`SystemDiagnosticsPage.tsx`, `AiProvidersPage.tsx`, `CommunicationsPage.tsx`) — same conclusion as before, re-checked rather than assumed.

## What this batch does NOT claim (final, covering both batches)

- Does not claim automated UI test coverage — none exists for any page in this repo; every state above was verified by code review against already-tested backend behavior, not by a running UI test.
- Does not claim the generic `authedFetchJson`-surfaced error codes are as informative as the server's actual `field`/`detail` payload — they aren't, and fixing that is a shared-client change, out of scope here.
- Does not claim `revert` (observed in the screenshot) is implemented — it isn't; it wasn't in Section 4's required operation list and was deliberately left out rather than silently added as unscoped extra work.
- Does not claim archive/un-archive is implemented as a user-facing operation — only the service-layer guard against editing/publishing an archived script exists; no UI or route reaches it.
- Does not claim this was tested against a real Supabase/Postgres database — only PGlite (backend) and manual code-level review (frontend).
- Does not claim audit-event emission was independently verified by a test, only that the emission call is present and follows the already-tested pattern.
