# Bell24h-OS Security Baseline

## Identity and RBAC

Supabase Auth is the identity source. Authorization must be enforced server-side and through database policies. Roles and permissions must be resolved for the authenticated user and organization; frontend visibility is not authorization.

## RLS and tenancy

Tenant-owned records require organization scope. The repository uses `get_current_org_id()` and broad generated organization policies in `supabase_schema.sql`; each table must still be reviewed for correct policy coverage and safe insert/update/delete checks.

## Secrets

Only public client configuration may be exposed to Vite. Provider keys, service-role credentials, database credentials, and signing secrets belong in server/runtime secret storage. Never store provider keys in ordinary tenant-readable records.

## Provider credentials

Provider credentials are accessed only by the server-side provider adapter. Credential use must be authorized, audited, rate-limited, and excluded from response bodies and logs.

## Audit logging

Audit events must include actor, organization, action, target type/id, timestamp, outcome, request ID, and safe metadata. Sensitive mutations, role changes, provider changes, AI requests, and administrative actions are mandatory audit events.

## Telemetry

Record operational metrics without leaking secrets or unnecessary personal data. Required dimensions include service, organization, job/request ID, provider/model where applicable, latency, outcome, retry count, and resource usage.

## Compliance checklist

- [ ] Authentication and session expiry tested
- [ ] RBAC tested server-side
- [ ] RLS tested for cross-tenant access
- [ ] Secrets absent from source and browser bundles
- [ ] Upload validation and storage policies reviewed
- [ ] Rate limits and abuse controls defined
- [ ] Audit coverage verified
- [ ] Error and log redaction verified
- [ ] Backup and rollback evidence available
- [ ] Dependency and vulnerability review completed
