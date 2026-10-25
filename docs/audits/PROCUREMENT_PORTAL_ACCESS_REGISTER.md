# Procurement Portal Access & Legal-Permission Register

Documentation only. No request was made to any portal below by this change — classifications are based on prior web research (search results, third-party coverage) and are explicitly marked unresolved where no authoritative source was found. **Nothing below should be read as legal advice or as clearance to run an adapter.**

## Important correction to this task's own framing

This task's briefing states "CPPP access returned HTTP 403 during one attempt." **This session has no record of making any direct request to CPPP, eprocure.gov.in, or any other procurement portal — at any point in this engagement.** All prior research was via web search (reading about the portals), never a direct `fetch`/`curl`/browser request to a live portal URL. If a 403 was observed, it happened outside what this session can see or verify, and this document does not confirm, deny, or reproduce it. It is recorded below as **reported-but-unverified-by-this-session**, not re-tested — re-testing it would itself be exactly the kind of unapproved probing this task's own safety rules prohibit ("do not attempt to bypass the block").

## Register

| Portal | URL | Official API/feed documentation | Access/auth requirements (where documented) | Evidence of permitted automated retrieval | Rate limits/usage restrictions | ToS/licensing review | Attribution/republication constraints | **Classification** | Evidence source & date | Next action to approve |
|---|---|---|---|---|---|---|---|---|---|---|
| CPPP (Central Public Procurement Portal) | `eprocure.gov.in/cppp` | Not found. One non-official marketing page claims generic "API connections," uncorroborated by any NIC/Ministry of Finance source. | Bidding requires Class III DSC + registration; the official overview states tender *viewing* requires no registration ("in public domain"). | None found. | Not found. | Not performed. | Not found. | **UNVERIFIED** (plus a reported, session-unverified 403 — see note above, treat as a possible additional blocker, not evidence either way) | Prior web research, this engagement, 2026-10-25 | Read the portal's actual `robots.txt` and terms-of-use page directly (not yet done); if a reported 403 is confirmed independently, escalate to DO NOT USE pending explicit permission |
| GeM (Government e-Marketplace) | `gem.gov.in` | Not found. Only third-party commercial scrapers (Apify, RealDataAPI) were found offering "GeM tender data" — itself evidence no sanctioned API likely exists, since a legitimate public API would make a paid scraper product largely redundant. | Not found/documented for public bulk access. | None found. | Not found. | Not performed. | Not found. | **UNVERIFIED, leaning DO NOT USE** until an official source is found | Prior web research, this engagement, 2026-10-25 | Contact GeM support/read gem.gov.in directly for any developer/open-data section before considering this further |
| Maharashtra e-Tenders | `mahatenders.gov.in` | **Explicitly confirmed absent** by a third-party source: "Maharashtra eTenders does not offer a public data API." Only an unaffiliated third party (Anakin) proxies 3 endpoints — not an official interface. | Standard NIC-GePNIC-platform pattern: tender listings published for bidder visibility. | None found. | Not found. | Not performed. | Not found. | **UNVERIFIED** | Prior web research, this engagement, 2026-10-25 | Contact `eproc.support@maharashtra.gov.in` (published support address) to ask directly about permitted bulk/automated access |

## Classification definitions

- **APPROVED**: an official source explicitly permits the intended automated access, with documented terms. (No portal is here yet.)
- **APPROVAL REQUIRED**: a path to permission exists (a contact, an application process) but has not been exercised.
- **UNVERIFIED**: no authoritative source was found either confirming or denying permitted automated access. Treated as **not safe to use** until resolved — this is the default and current state for all three portals above.
- **DO NOT USE**: explicit evidence of prohibition, a technical block (e.g. a confirmed, reproducible 403), or a ToS violation risk.

## Binding rule for the ingestion pipeline

`server/ingestion/TenderIngestionPipeline.ts`'s `APPROVED_SOURCE_IDS` constant is **empty**, enforced by a passing test (`TenderIngestion.test.ts`, "the production default APPROVED_SOURCE_IDS is empty"). No source in this register may be added to that constant until its row above reads **APPROVED**, with a specific evidence source and date recorded. Opening a page in a browser and seeing tender listings is explicitly **not** sufficient grounds for that classification.
