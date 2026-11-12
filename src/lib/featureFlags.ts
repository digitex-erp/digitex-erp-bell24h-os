/**
 * Client-side feature flags for capabilities that have no real implementation.
 * Default OFF: a flag is on only when its VITE_ variable is exactly "true".
 *
 * These flags only decide what the browser shows. They are NOT a security
 * control; the server enforces the matching ENABLE_* variables on
 * POST /api/v1/queue/enqueue (see server/lib/capabilityFlags.ts).
 */

export function parseFlag(raw: unknown): boolean {
  return raw === "true";
}

export const ENABLE_IMAGE_STUDIO = parseFlag(import.meta.env?.VITE_ENABLE_IMAGE_STUDIO);
export const ENABLE_VIDEO_STUDIO = parseFlag(import.meta.env?.VITE_ENABLE_VIDEO_STUDIO);
export const ENABLE_PUBLISHING = parseFlag(import.meta.env?.VITE_ENABLE_PUBLISHING);
