# REA Readiness Procedure (owner-run; not installed or configured by this change)

This document is a procedure for the **owner** to run, not something this PR executes. No package was installed and no MCP configuration was changed by this change.

## What was found, read-only, in an earlier audit this engagement

- `rea-agents` is **not** installed as a persistent local package (`npm ls rea-agents` returns nothing in this repo; no global package; no binary on `PATH`).
- REA **is** registered as an MCP server, but at the **user/global** level (`~/.claude.json`'s `mcpServers.rea`), not in this project's `.mcp.json`:
  ```json
  "rea": { "command": "cmd.exe", "args": ["/d","/c","npx","-y","rea-agents@6.7.0","mcp"] }
  ```
  It launches on demand via `npx -y rea-agents@6.7.0 mcp` — no persistent install is required for it to work this way.

## Procedure to verify readiness in a fresh session (run these yourself; none of this was executed by this PR)

1. **Confirm registration**: open `~/.claude.json` and check for a `mcpServers.rea` entry. If absent, REA is not configured for this Claude Code installation at all.
2. **Confirm the server actually loads in a fresh session**: start a new Claude Code session in this repository and check whether any `mcp__rea__*` tool name appears in the available/deferred tool list. If none appear, the MCP handshake failed — check for a version mismatch or a network issue reaching the npm registry (since `npx -y` needs to resolve the package).
3. **Confirm the installed version and its tool schema**: the version is pinned in the config (`rea-agents@6.7.0` as found). To check a different/newer version's tool surface without changing the committed config, run `npx rea-agents@<version> mcp --help` (or equivalent) **in your own terminal, outside this session** — this fetches and executes third-party code, which is why it is not run automatically here.
4. **Confirm `inspect_web_network_capture` (or whichever HAR-inspection tool name the installed version actually exposes) is supported**: tool names can change between REA versions. Check the live tool list for the exact current name once connected (do not assume the name found in an earlier audit pass is still current without checking).
5. **Confirm HAR analysis can run fully offline**: REA's capture-inspection tools read a local file path you provide — they do not themselves need network access to parse an already-exported HAR. Verify this expectation against the specific tool's own description once loaded, since tool descriptions are the authoritative source, not this document.

## Using a sanitized HAR safely, once Phase 1 (owner-driven, real browsing) is approved

- Export the HAR from DevTools only after a normal, permitted public browse/search session — no login bypass, no CAPTCHA automation.
- **Before sharing or committing anything derived from it**: strip every `Authorization` header, `Cookie` header, bearer token, API key, signed URL, and session identifier. A HAR file is not safe to share as-is; a sanitized *summary* (URLs, methods, parameter names, response shapes) is what should ever leave your machine.
- **Never commit a raw HAR file to this or any repository.**
- REA inspects the sanitized file locally; its output (observed endpoints/shapes) should be written into a plain report, not the HAR itself.
- This foundation (the code in `server/ingestion/`) does not depend on REA being available — REA is a reconnaissance aid for Phase 1 of the roadmap, not a runtime dependency of the ingestion pipeline itself.

## Explicit non-goals

- Do not replay any captured request against a real portal.
- Do not use anything found via REA to bypass authentication, a CAPTCHA, a rate limit, or an access restriction.
- Do not treat a single HAR capture as "stable, documented behavior" — a second, independent capture is needed before relying on an inferred pattern (e.g. pagination parameters).
