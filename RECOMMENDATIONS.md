# Recommendations

1. Keep the governance documents as the required precondition for every sprint.
2. Add CI checks for TypeScript, build, tests, migration validation, and secret scanning.
3. Establish a canonical domain/table registry before adding Marketplace or Intelligence work.
4. Move provider execution and secret access behind a server-side AI Router boundary.
5. Start the queue worker as a dedicated managed runtime and test recovery before relying on generated jobs.
6. Create RLS and organization-isolation tests before declaring any module production-ready.
7. Replace placeholder services with explicit unsupported responses or approved implementations; never return fake success.
8. Consolidate database changes into an ordered migration workflow.
9. Add operational SLOs, structured logging, health checks, and deployment rollback documentation.
10. Do not begin Sprint C or Sprint D until Foundation and Runtime review gates have evidence for the risks above.
