# Bell24h-OS Architecture Decisions

## Decision status

This document records the governing target architecture. Current repository compliance is assessed separately in `ARCHITECTURE_COMPLIANCE_REPORT.md`.

## Approved architecture

```text
Foundation
  -> Marketplace
  -> Industry Intelligence
  -> SEO Intelligence
  -> Enterprise AI Router
  -> Content and Creative Factories
  -> Publishing
  -> Performance Intelligence
  -> Learning and Optimization
```

The runtime consists of a React/Vite frontend, an Express/Node server boundary, Supabase Auth/PostgreSQL/Storage, durable queue workers, and provider adapters behind the AI Router.

## Module boundaries

- Foundation owns identity, organizations, teams, roles, permissions, settings, diagnostics, audit, telemetry, and cost controls.
- Marketplace owns buyers, suppliers, products, RFQs, matching, quotations, and orders.
- Industry Intelligence owns canonical industries, taxonomies, markets, HSN, standards, and relationships.
- SEO Intelligence owns keywords, intent, competitors, opportunities, ranking, and recommendations.
- AI Router owns provider selection, policy, budgets, fallback, retries, circuit breakers, telemetry, and provider cost.
- Creative modules own asset workflows but never provider credentials or provider routing policy.
- Publishing owns approved content delivery and publication state.
- Performance and Learning consume recorded outcomes; they do not mutate source business facts without an explicit workflow.

## Dependency rules

- Feature modules may depend on Foundation contracts, not the reverse.
- UI may call approved application services or APIs, not provider SDKs directly.
- Marketplace may consume Industry Intelligence; Industry Intelligence must not depend on Marketplace UI.
- Creative and Publishing depend on AI Router and approval/state contracts.
- Analytics consumes event and domain data; it must not become a second system of record.
- Cross-module writes use explicit services or jobs.

## Approved extension points

- Service contracts in `src/modules`.
- Express routes in `server.ts` or a future route layer.
- Supabase migrations/schema scripts with review evidence.
- Queue job types and worker handlers.
- AI provider adapters implementing the common provider contract.
- Typed telemetry, audit, and cost event contracts.

## Forbidden dependencies

- Direct provider calls from pages or browser components.
- Secret values in Vite client variables, source, logs, or database fields readable by ordinary users.
- Cross-tenant queries without an explicit authorization model.
- Duplicate domain tables created to avoid understanding an existing model.
- Hardcoded users, metrics, health results, or production readiness states.
- UI-only mutations presented as completed workflows.
- Unreviewed destructive migrations.
