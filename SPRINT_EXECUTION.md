# Bell24h-OS Sprint Execution

## Lifecycle

1. Define a bounded sprint objective and exclusions.
2. Inspect repository, schema, runtime, and deployment state.
3. Record dependencies, risks, acceptance criteria, and rollback plan.
4. Implement only approved scope.
5. Run automated and manual verification.
6. Produce the required reports and evidence.
7. Pass the review gate before authorizing the next sprint.

## Review Gate

The gate owner verifies scope, changed files, build, tests, security, RLS, tenant isolation, database integrity, API behavior, queue behavior, audit, telemetry, cost tracking, deployment, and rollback evidence as applicable.

## Acceptance criteria

Every acceptance criterion must be observable. “Page renders” is insufficient; the underlying API, mutation, authorization, persistence, failure behavior, and audit/telemetry path must be verified.

## Required reports

- Implementation summary
- Functional verification
- Database and migration report
- Security/RLS report
- Test report
- Operational telemetry report
- Production gap and risk update
- Changed-file explanation

## Deployment evidence

Record commit SHA, build result, deployment identifier, environment, migration result, health checks, browser/runtime evidence, and rollback target. Environment values and secrets must be redacted.

## Rollback expectations

Every schema or runtime change must have a rollback or forward-fix plan. Rollback must not destroy tenant data. Queue jobs must remain recoverable or be explicitly requeued.

## Stop conditions

Stop and report when scope expands, a security boundary is unclear, production data could be lost, a dependency is unavailable, or a test exposes an unresolved critical defect.
