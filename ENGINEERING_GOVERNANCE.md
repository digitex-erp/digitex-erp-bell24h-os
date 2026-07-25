# Bell24h-OS Engineering Governance

Status: Authoritative engineering constitution
Scope: Entire Bell24h-OS repository
Evidence baseline: repository state audited on 2026-07-25

## Purpose

Bell24h-OS is the private operating system intended to power VyaparSethu. This document governs architecture, implementation, security, review, and delivery. It does not authorize feature work by itself.

## Architecture Rules

- Preserve clear boundaries between Foundation, Marketplace, Industry Intelligence, SEO Intelligence, AI, Creative, Publishing, Performance, and Learning layers.
- Reuse an existing domain model or service before creating a new one.
- Maintain one canonical representation for organizations, profiles, products, categories, providers, jobs, and assets.
- All asynchronous work uses the approved queue and worker boundary.
- All AI requests use the Enterprise AI Router; pages and feature modules must not call providers directly.
- Browser code may use the public Supabase client only for explicitly approved tenant-scoped operations. Secrets and privileged operations belong behind a server boundary.
- Architecture changes require an Architecture Decision Record and review-gate approval.

## Database Rules

- PostgreSQL/Supabase is the system of record.
- Every tenant-owned table must have a deliberate organization-isolation policy.
- RLS is mandatory for tenant-owned data and must be tested, not assumed.
- Business records use soft deletion or explicit lifecycle states.
- Reference data is versioned and must not be duplicated per tenant without a documented reason.
- Foreign keys, indexes, uniqueness, and audit retention must be defined with each schema change.
- Destructive migrations require explicit approval, backup evidence, and rollback instructions.

## API Standards

Every server API must define authentication, authorization, input validation, organization scope, structured errors, logging, and telemetry. Collection APIs must support pagination and bounded filtering. Mutations must be idempotent where retries are possible and must emit an audit event.

## Security Standards

- Enforce RBAC and organization isolation server-side and through RLS.
- Never commit credentials or expose provider secrets to browser bundles.
- Validate redirect URLs, uploads, file types, size limits, and external URLs.
- Use least privilege for service credentials.
- Fail closed when identity, organization, or authorization cannot be resolved.
- Security-sensitive actions require audit events with actor, tenant, action, target, and outcome.

## AI Standards

- The AI Router is the only provider execution boundary.
- Provider adapters implement a common contract and expose capability, health, cost, and failure metadata.
- Open/self-hosted providers are preferred when policy, capacity, and quality permit.
- Commercial providers are fallback options subject to policy and budget.
- Every request records organization, actor, provider, model, latency, usage, cost, status, and retry outcome.
- AI output never bypasses business validation, permissions, approval, or publishing controls.

## Coding Standards

- Use strict TypeScript types; avoid `any` at boundaries.
- Keep UI components focused on presentation and interaction.
- Put domain behavior in services with explicit contracts.
- Centralize Supabase access patterns and error handling.
- Do not silently ignore returned errors.
- Do not use hardcoded production status, users, metrics, or success results.
- Add tests for every new service, mutation, authorization rule, and queue transition.

## Review Gate Requirements

Each sprint must provide scope evidence, changed-file evidence, passing build and tests, security and RLS verification, migration/rollback evidence, telemetry and audit evidence, deployment evidence where applicable, and an updated risk register. Failed criteria block the next sprint.

## Definition of Done

A change is done only when implementation, tests, documentation, observability, authorization, error handling, and review evidence are complete. A UI that renders without a verified backend action is not complete.

## Scope Control

Work must stay within the approved sprint. New features, framework additions, schema duplication, broad refactors, and unrelated cleanup require explicit scope approval. When a prerequisite is missing, record it as a blocker rather than hiding it with a placeholder.

## Documentation Rules

Update the relevant governance, architecture, API, database, testing, and operational documentation with each material change. Documentation must identify actual repository evidence and distinguish current state from target state.
