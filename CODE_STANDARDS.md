# Bell24h-OS Code Standards

## Repository structure

- `src/pages`: route-level UI only.
- `src/components`: reusable UI and layout components.
- `src/modules`: domain services and runtime modules.
- `src/lib`: shared clients and utilities.
- `supabase_schema.sql` and migration scripts: database definitions and changes.
- `MASTER_CONTEXT`: project context and existing contracts.
- `server.ts`: server bootstrap and approved server routes until route modules are introduced.

## Naming

Use PascalCase for React components and classes, camelCase for functions and variables, and descriptive singular domain names. Database tables and columns use snake_case. API names use stable nouns and explicit action names only when a noun-based mutation is insufficient.

## Service conventions

Services expose typed inputs and outputs, validate identity and organization scope, return or throw structured errors, and never hide database errors. Provider services implement a shared adapter contract. Queue handlers are idempotent and persist state transitions.

## Repository conventions

Repository/data-access code must centralize query construction, tenant scoping, pagination, and error translation. Direct page-level mutations are legacy behavior and must not be copied into new modules.

## Error handling

Errors must preserve a safe user message, an internal diagnostic context, a correlation/request ID, and an appropriate status. Never log credentials, tokens, raw prompts containing secrets, or full personal data unnecessarily.

## Logging

Use structured logs with timestamp, level, service, request ID, user ID where appropriate, organization ID, action, duration, outcome, and error classification. Health endpoints must not report success from constants.

## Testing

New work requires unit tests for domain logic, integration tests for database/API behavior, RLS tests for tenant-owned data, and end-to-end tests for critical workflows. Queue work requires retry, timeout, idempotency, failure, and recovery tests.
