/**
 * Vercel serverless entry point.
 *
 * OS-INTEGRATION-IMPLEMENTATION-01: this is the minimum deployment configuration
 * needed to run the existing Express app (server.ts) on Vercel — not a new server,
 * not a rewrite. It imports the same `createApp()` used by traditional hosting
 * (`npm run dev`, `node dist/server.cjs`) and forwards each invocation to it.
 *
 * The Express app instance is built once per warm serverless instance (not once per
 * request) via the cached `appPromise` below, consistent with Vercel's own guidance
 * for wrapping an existing Node.js HTTP handler.
 */

import { createApp } from "../server.js";

let appPromise: ReturnType<typeof createApp> | null = null;

export default async function handler(req: any, res: any) {
  if (!appPromise) {
    appPromise = createApp();
  }
  const app = await appPromise;
  app(req, res);
}
