# Shogo Communication Module — Screenshot Gaps

What additional screenshots are needed, and precisely what each must show, to close the evidence gaps this audit found. Organized by why the screenshot is needed, not just a filename list — each entry states the exact UI state and data condition required, per the task's instruction.

## Why these are needed at all

This audit relied on source-file reads (routes, Prisma models, page component headers) rather than rendered screenshots for most items, because the Shogo checkout is read-only reconnaissance in this engagement and no screenshot capture was performed. The gaps below are specifically the places where a source-file read cannot settle the question — either because the real/simulated distinction is only visible at runtime (e.g. whether `SimBanner` actually renders for a given item), or because a destination-side screenshot is needed to support a "LIKELY REDUNDANT, unverified" verdict already on record.

## Shogo-side screenshots needed (to confirm what the UI actually shows, not just what the route/component claims)

1. **`/voice/hub` (Communication Hub SIM) — full page, default load, with `SimBanner` visible and at least one row in each of the voice/whatsapp/email tone sections.** Needed because this item's register entry currently relies on a static `grep` match of the component's title string, not a rendered view confirming `SimBanner` actually fires on this specific route (vs. only on `/voice/overview`).
2. **`/voice/scripts` (Call Scripts) — the script studio's list view AND the create/edit form, showing the `opening/verification/questions/objections/negotiation/closing/escalation/fallback` fields filled with real-looking sample content.** Needed to confirm these are the actual field names/structure before they're used to scope a destination route (this audit took the field list from the existing `voice_scripts` migration, which was itself ported from the Prisma model, not independently re-verified against the live Shogo UI).
3. **`/voice/receptionist` (AI Receptionist) — the full config screen, showing whatever "inbound call" concept it exposes (greeting script, routing rules, fallback-to-human trigger, etc.).** This is the single most important screenshot gap: the register marks this item as having no destination schema at all because `VoiceDispatchInput` is outbound-only, but that conclusion was reached from the route's own name and a config-field list, not a screenshot of what inbound-specific fields actually exist. A screenshot here could change the "needs its own schema design" verdict into something smaller or larger.
4. **`/voice/automation` (Automation Rules) — the rule designer mid-edit, showing one complete TRIGGER->CONDITION->AI DECISION->ACTION chain with real-looking values in each stage.** Needed because this item is flagged as "most architecturally novel" (needs a real rule-evaluation engine) and the exact shape of what the engine would need to evaluate is only visible in a filled-out example, not the field-name list alone.
5. **`/voice/analytics` (Call Analytics) — the full dashboard with at least 3 distinct chart/KPI types visible.** Needed to confirm which aggregate queries the destination would actually need to build (the register currently assumes "COUNT/AVG/SUM grouped by outcome/driver/date" from the route's category, not from seeing the actual charts).
6. **`/voice/settings` (Communication Settings) — the full settings page, every section expanded/visible.** Needed to resolve the open scope question (is this `voice_policies`'s UI, or broader) — this cannot be resolved from a field-name grep since no "settings" model distinct from `VoicePolicy` was found in the schema.

## Destination-side screenshots needed (to support "LIKELY REDUNDANT, unverified" verdicts already on record from the roadmap)

7. **Bell24h-OS `DashboardPage.tsx` rendered, alongside Shogo's `Dashboard.tsx` rendered — side by side, same data categories if possible.** Needed to convert "Overview/Dashboard: LIKELY REDUNDANT, unverified content parity" into a real verdict.
8. **Bell24h-OS `SettingsPage.tsx` rendered, full page.** Needed for the same reason as #7, paired with Shogo screenshot #6 above.
9. **Bell24h-OS `SystemDiagnosticsPage.tsx` rendered, full page.** Needed to settle whether this is the same scope as Shogo's `SystemHealthPage.tsx` (currently HOLD, "not the same scope" is an inference from the page name and the DB/auth/schema-sync focus already documented from Sprints 11-12, not from a side-by-side visual compare).

## Screenshots that would NOT add value (explicitly excluded, to avoid padding this list)

- WhatsApp Business sub-areas (~20 items) — already conclusively resolved as 100% front-end simulation with zero backend by a prior sprint's code-level finding (`/api/whatsapp/*` does not exist); a screenshot of a simulated UI would not change that verdict.
- Avatar Studio, Colibrì Demos — no source file exists to screenshot.
- Items already fully implemented and tested this engagement (AI Voice Center, Call History, Conversations) — their destination behavior is already verified by 29 passing automated tests, which is stronger evidence than a screenshot.

## What each screenshot must NOT be mistaken for

Per the task's "never infer that a feature works merely because its page exists or displays sample data" instruction: every screenshot above is requested to settle a **scope or field-shape** question, not to re-confirm "does the feature work." A Shogo screenshot showing populated-looking data is expected in every case (Shogo's own `SimBanner`/`SimTag` convention means populated sample data is normal even where zero backend exists) and must not be read as evidence of real functionality — only as evidence of what fields/structure a future destination implementation would need to replicate.
