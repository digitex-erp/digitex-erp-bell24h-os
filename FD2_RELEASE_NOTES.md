# Bell24h-OS FD2 Release Notes

**Release Version:** Phase FD2 Production Release Candidate  
**Target Environment:** Production  
**Git Author:** Vishal Pendharkar (`bell24h.info@gmail.com`)  
**Target Repository:** `digitex-erp/digitex-erp-bell24h-os`  

---

## 1. What's Included in This Release

### Core Intelligence & Enterprise Modules
* **Authentication Engine:** Full Supabase Auth lifecycle, session persistence, automatic token renewal, and protected routing.
* **VyaparSethu Root Organization:** Single root organization (`abdb43db-8bc0-46ff-8d22-e8c4eec26676`) with certified tenant isolation and RLS security.
* **Team Governance:** Team roster management displaying Super Admin and Admin roles.
* **Executive Dashboard:** Central operations dashboard with real-time tenant context.
* **Enterprise SEO Center v3.0:** 12 enterprise intelligence suites backed by 18 Supabase RLS tables (Keywords, Site Audits, Rankings, Broken Links, Schema Markups, Competitors, Backlinks, Content Scores, AI Visibility, Geo Audits, Citations, Alerts).
* **Communication Hub Core (FD1):** High-throughput PostgreSQL `FOR UPDATE SKIP LOCKED` Queue Core and Worker Fleet runtime.
* **Module Shells:** Prompt Studio, AI Provider Manager, Knowledge Vault, and Automation Center.

---

## 2. Exclusions (Zero Mock Enforcement)
To maintain 100% production code integrity, all mock or placeholder services have been purged:
* ❌ `src/modules/voice/VoiceService.ts` (Mock TTS/STT stub deleted)
* ❌ `src/modules/crm/CrmService.ts` (Unrouted customer stub deleted)
* ❌ Buyer Management, Supplier Management, Marketplace, and RFQ Engine remain staged for subsequent roadmap phases.
* ❌ WhatsApp Meta Cloud API adapters remain staged for Phase FD2 activation.

---

## 3. Production Deployment Compatibility
* Verified Vercel Hobby Plan compatibility with commit author `Vishal Pendharkar <bell24h.info@gmail.com>`.
* Automatic CI/CD pipeline from `main` to Vercel production.
