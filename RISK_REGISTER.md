# Bell24h-OS Risk Register

| ID | Risk | Severity | Evidence | Mitigation | Owner Gate |
|---|---|---:|---|---|---|
| R-001 | Tenant data exposure from inconsistent organization scoping | Critical | Direct queries and broad schema surface | Centralize access, test RLS, add cross-tenant tests | Foundation |
| R-002 | Provider credentials exposed through client-accessible flows | Critical | Provider configuration and direct client manager usage | Server-side secrets and router boundary | Runtime |
| R-003 | Jobs are queued but workers are not started | Critical | `src/main.tsx` comments out worker startup | Dedicated worker process and health checks | Runtime |
| R-004 | No automated regression protection | Critical | No test/spec files found | Add unit, integration, RLS, and E2E suites | Foundation |
| R-005 | Placeholder services create false readiness signals | High | Empty-array and placeholder implementations | Mark unsupported paths and implement behind gates | Foundation |
| R-006 | Schema drift and migration-order failure | High | Many additive SQL scripts | Versioned migration process and schema CI | Runtime |
| R-007 | Silent mutation/query errors | High | Inconsistent error handling in pages/services | Structured errors, logging, and failure UI | Foundation |
| R-008 | Hardcoded diagnostics or operational status | High | Diagnostics/database UI behavior | Real health probes and evidence | Runtime |
| R-009 | Duplicate domain concepts emerge across modules | Medium | Broad module and schema inventory | Architecture review and canonical model registry | All gates |
