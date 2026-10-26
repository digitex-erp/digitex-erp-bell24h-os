/**
 * Single source of truth for which procurement-source ids may be ingested.
 *
 * Explicit allow-list, mirroring docs/audits/PROCUREMENT_PORTAL_ACCESS_REGISTER.md's
 * feasibility classification. Only a source explicitly marked APPROVED there
 * may run through the ingestion pipeline -- everything else (including every
 * real portal examined so far: cppp, gem, maharashtra_etenders, all currently
 * UNVERIFIED or worse per that register) is rejected by construction.
 *
 * Empty in this phase deliberately: no real source has cleared legal/ToS
 * review yet (see the register).
 *
 * SECURITY (fixes an independent-review P1 finding): the set below is
 * module-private and never exported. Previously it was exported directly as
 * `ReadonlySet<string>` -- a TypeScript-only annotation with no runtime
 * effect, so the underlying JS `Set` was fully mutable by any caller that
 * imported it (`.add()` succeeded, permanently and globally, for the life of
 * the process). There is now no object reference any caller -- test or
 * production -- can obtain to mutate. The ONLY way to check approval is
 * `isSourceApproved()`, which returns a boolean, never a reference.
 *
 * Test injection is isolated behind the two `__...ForTesting` functions
 * below: a production call path (`ingestFromSource` in
 * TenderIngestionPipeline.ts) has no parameter that can reach them -- they
 * must be imported and called explicitly, by name, which is a deliberate
 * action a reviewer or linter can spot, not a side effect of any ordinary
 * request.
 */
const approvedSourceIds = new Set<string>();

export function isSourceApproved(sourceId: string): boolean {
  return approvedSourceIds.has(sourceId);
}

/** Read-only count, for a test to confirm the production default is empty without exposing the Set itself. */
export function getApprovedSourceCount(): number {
  return approvedSourceIds.size;
}

/**
 * TEST-ONLY. Replaces the approved-source set entirely (not an additive
 * `.add()`) so a test's intent is always "exactly these ids are approved,"
 * never "whatever was left over from a previous test." Never call this
 * outside a test file.
 */
export function __setApprovedSourceIdsForTesting(ids: Iterable<string>): void {
  approvedSourceIds.clear();
  for (const id of ids) approvedSourceIds.add(id);
}

/** TEST-ONLY. Restores the empty production default. Never call this outside a test file. */
export function __resetApprovedSourceIdsForTesting(): void {
  approvedSourceIds.clear();
}
