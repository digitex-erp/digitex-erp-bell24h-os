# Technical Debt Report

## Critical

- No automated test suite is present.
- Queue worker startup is disabled/commented.
- AI provider execution is not consistently isolated behind a server-side router.
- Placeholder services return empty or fabricated results.
- Organization/profile absence is handled silently in key pages.

## High

- Direct page-level Supabase mutations and queries are duplicated.
- Error handling is inconsistent and often ignores returned errors.
- Admin and Settings workflows contain UI-only actions.
- Schema changes are spread across many additive SQL files without a demonstrated migration pipeline.
- Diagnostics contains checks that are not all real runtime checks.

## Medium

- Client-side polling is used for job displays.
- Search/filtering is mostly client-side.
- API contracts exist as documentation but are not consistently backed by Express routes.
- Service typing is inconsistent and uses `any` in places.

## Low

- Naming and module documentation are not uniform.
- The package name remains `react-example`, which is inconsistent with the product identity.
