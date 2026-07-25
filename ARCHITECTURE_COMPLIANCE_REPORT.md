# Architecture Compliance Report

## Summary

The repository has a recognizable React/Vite + Express + Supabase module layout, but it does not yet conform to the approved layered architecture.

## Findings

- Pages directly import `AIManagerService` in Content Planner, Image Studio, Video Studio, Prompt Studio, and AI Providers.
- Provider adapters call external APIs directly from `src/modules/ai-providers/AiProviderService.ts`.
- `JobWorker` exists but startup is commented out in `src/main.tsx`.
- `server.ts` exposes only health, environment diagnostics, migration, and static/Vite serving routes; feature APIs are not centralized there.
- Several services are placeholders or return empty arrays, including `AdminService`, `DatabaseService`, `AgentService`, `KnowledgeBaseService`, `CrmService`, and `VoiceService`.

## Classification

Architecture alignment: Partial.
Layer boundaries: Partial.
AI Router boundary: Non-compliant in current call paths.
Queue boundary: Defined but runtime startup incomplete.
API boundary: Incomplete.
