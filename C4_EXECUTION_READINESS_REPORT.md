# C4 Execution Readiness Report

**Date:** 2026-09-28. Read-only. No code modified.

## Finding first: "Gate C4" does not exist in this repository's governance record

Before assessing readiness, a direct search of every governance/planning doc in this repo (`docs/architecture/`, `docs/project/`, `ARCHITECTURE_DECISIONS.md`) for a gate named "C4" or "C.4" returned **zero matches**. The gates this repository actually defines and tracks are: **Gate A, Gate B, Gate C, Gate C.1, Gate C.2, Gate C.2C, Gate D.1** (the last being today's own `docs/project/GATE_D1_COMMUNICATION_HUB_RATIFICATION_AND_PROVIDER_GATE.md`).

Per the constitution ("if a prescribed remedy turns out to rest on a false premise, say so before implementing it"): rather than inventing a "C4" gate definition to satisfy this request, this report treats "C4" as most likely meaning **RFQ workflow / buyer-supplier execution readiness** (the closest thing the request actually describes — buyer/supplier test accounts and RFQ workflow), and evaluates that directly. If "C4" refers to a specific gate defined somewhere outside this repo (a external tracker, a prior chat, a document not checked in here), that source should be named so this report can be corrected against the real definition instead of a guess.

## RFQ workflow — schema readiness (source-level, direct file evidence)

`supabase_schema.sql` defines the full RFQ chain with organization scoping on every table:
- `buyers` (line 135), `suppliers` (line 147), `contacts` (159), `categories` (174), `products` (186)
- `rfqs` (200) — has `status` (default `DRAFT`), `due_date`, `organization_id`
- `rfq_items` (213) — FK'd to `rfqs.id` and `products.id`
- `quotations` (226) — FK'd to `rfqs.id` and `suppliers.id`, `status` (default `PENDING`), `total_amount`

This is a complete, coherent RFQ data model **as source** — and nothing more. A repo-wide grep for `/api/rfq`, `/api/quotations`, and any direct table reference to `rfqs`/`quotations` (`.from('rfqs')`, `.from('quotations')`, etc.) across every `.ts` server file and every `.tsx` frontend file returned **zero matches, anywhere in the codebase**. Confirmed, not inferred: **the RFQ/quotation tables exist only as unused schema.** No backend route, no frontend page, no Supabase-client call touches them. This is a materially bigger gap than "readiness" — it's "not started" at the application layer, matching what Phase 4's `RFQ_MATCHING_MASTER_PLAN.md` independently classifies as the base RFQ CRUD layer status.

## Buyer A / Supplier A / Supplier B — status

| Account | Status | Basis |
|---|---|---|
| Buyer A | **MISSING DATA** | No test-account seed data found in the repository (no seed script, no fixture file references a "Buyer A"). Existence can only be confirmed against the live database. |
| Supplier A | **MISSING DATA** | Same — no repository-level evidence either way. |
| Supplier B | **MISSING DATA** | Same. |

None are marked BLOCKED outright, because the schema itself is ready to hold this data (`buyers`/`suppliers` tables exist in source) — the gap is specifically **unknown live state**, not a structural defect. Per the constitution, "cannot verify" is reported as its own category rather than guessed in either direction.

## Required SQL (per standing manual-verification policy — generate only, do not execute)

Consistent with `SUPABASE_RV001_READINESS_REPORT.md`'s RV-004, these two checks resolve the account question and should be run in the same Supabase SQL Editor session:

### RV-007 — Do Buyer A / Supplier A / Supplier B exist?
**Objective:** confirm whether named test accounts exist for buyer/supplier RFQ testing, and which organization they belong to.
**SQL Query:**
```sql
select 'buyer' as role, id, name, organization_id, created_at from public.buyers
where name ilike '%buyer a%'
union all
select 'supplier' as role, id, name, organization_id, created_at from public.suppliers
where name ilike '%supplier a%' or name ilike '%supplier b%'
order by role, name;
```
**Expected Result:** either 0 rows (accounts don't exist yet — must be created) or up to 3 rows naming the existing test accounts and confirming they share one `organization_id` (required for them to transact RFQs against each other under the RLS org-scoping model).
**Interpretation:** 0 rows = **BLOCKED**, accounts must be created before any C4-equivalent RFQ workflow test can run. Rows present but with different `organization_id` values = **BLOCKED** for a different reason — cross-org RFQ testing isn't a valid scenario under this schema's org-isolation design. Rows present, same org = **READY** to proceed to an actual RFQ-creation test.
**Next Step:** paste the result. **Status: UNKNOWN — awaiting evidence.**

### RV-008 — Is there an existing RFQ + quotation to exercise the workflow end-to-end?
**Objective:** confirm whether any RFQ has ever been created and quoted against, as the simplest possible readiness signal for the workflow (schema is necessary but not sufficient — a row proves the write path works).
**SQL Query:**
```sql
select r.id as rfq_id, r.title, r.status, r.organization_id,
       count(q.id) as quotation_count
from public.rfqs r
left join public.quotations q on q.rfq_id = r.id
group by r.id, r.title, r.status, r.organization_id
order by r.created_at desc
limit 10;
```
**Expected Result:** 0 rows (no RFQ has ever been created — workflow untested end-to-end) or N rows showing RFQs and how many quotations each received.
**Interpretation:** 0 rows = the RFQ write path has never been exercised, independent of the account question — treat as **MISSING DATA**, not proof the workflow is broken, but not proof it works either. Rows present with `quotation_count > 0` for at least one = strong evidence the buyer→RFQ→supplier→quotation path is at least mechanically functional.
**Next Step:** paste the result. **Status: UNKNOWN — awaiting evidence.**

### RV-009 — Do Buyer A / Supplier A / Supplier B have actual login credentials, not just entity rows?

**Why this is a separate check from RV-007:** `public.buyers`/`public.suppliers` (`supabase_schema.sql:135-156`) are CRM-style entity records — each has `organization_id` and `created_by` (a foreign key to `public.profiles.id`, which is itself keyed to `auth.users.id`), but no login of their own. A row named "Buyer A" existing in `public.buyers` proves a business-entity record exists; it does **not** prove anyone can authenticate as that buyer and actually exercise the RFQ workflow. The original request's phrasing ("Buyer accounts / Supplier accounts / **Test credentials**") lists these as three distinct items for exactly this reason — RV-007 alone must not be read as settling this.

**Objective:** confirm each buyer/supplier entity found by RV-007 resolves to a real, loggable-in `auth.users` account.
**SQL Query:**
```sql
select b.name as entity_name, b.created_by as profile_id, p.id as profile_exists,
       u.id as auth_user_id, u.email, u.last_sign_in_at
from public.buyers b
left join public.profiles p on p.id = b.created_by
left join auth.users u on u.id = p.id
where b.name ilike '%buyer a%'
union all
select s.name, s.created_by, p.id, u.id, u.email, u.last_sign_in_at
from public.suppliers s
left join public.profiles p on p.id = s.created_by
left join auth.users u on u.id = p.id
where s.name ilike '%supplier a%' or s.name ilike '%supplier b%';
```
**Expected Result:** one row per entity found in RV-007, each resolving to a non-null `auth_user_id` and `email`.
**Interpretation:** any row with `auth_user_id` null means that entity exists as a record but has no real user behind it — no one can log in as that account today, regardless of what RV-007 showed. `last_sign_in_at` being null means the account has never actually authenticated even if it technically could. **This report's RV-007 alone must not be read as "accounts are READY" — only RV-009 confirms a tester can actually log in and drive the workflow.** Password/credential existence itself cannot be confirmed by SQL (hashes aren't meaningful evidence of a working login) — if `auth_user_id` is present, the founder separately confirms whether a known test password exists for that account, since no agent may request or handle that value.
**Next Step:** paste the result, and separately confirm (in plain language, not by sharing the password) whether test credentials are known for any account that resolves. **Status: UNKNOWN — awaiting evidence.**

## Overall status: BLOCKED

Per the constitution, one unverified/missing item is enough to block a PASS — and here the entire account and workflow-execution layer is unverified. Ordered path to unblock:

1. **Human decision needed:** confirm what "Gate C4" actually refers to, if it's a defined gate outside this repo — this report proceeded on a best-effort interpretation (RFQ execution readiness) and should be corrected if that's wrong.
2. **Run RV-007, RV-008, and RV-009** (SQL above) and paste results — RV-007 alone (entity rows exist) is not sufficient; RV-009 confirms whether a real, loggable-in account backs each entity.
3. If accounts are missing (RV-007 returns 0 or cross-org rows) or unauthenticatable (RV-009 shows null `auth_user_id`): create/link Buyer A, Supplier A, Supplier B under one organization with real `auth.users` accounts — this is a data-seeding task, not a code change, and is explicitly not performed in this pass per "audit only, do not modify."
4. **Independent of account seeding:** the RFQ workflow has no application layer at all (confirmed above) — this is a build gap, not a readiness gap, and needs its own sprint (see `RFQ_MATCHING_MASTER_PLAN.md`) before any C4-equivalent test is meaningful even once accounts exist.
