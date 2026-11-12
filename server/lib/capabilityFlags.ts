/**
 * Server-side capability flags for job types that have no real implementation.
 *
 * Default OFF. A flag is on only when its env var is exactly "true".
 * These are the enforcement point for POST /api/v1/queue/enqueue; the VITE_
 * flags in src/lib/featureFlags.ts only control what the browser shows.
 */

export type GatedCapability = "image" | "video" | "publishing";

export const CAPABILITY_ENV_VARS: Record<GatedCapability, string> = {
  image: "ENABLE_IMAGE_STUDIO",
  video: "ENABLE_VIDEO_STUDIO",
  publishing: "ENABLE_PUBLISHING",
};

// "social" runs through the same PublishingJobHandler, so it follows the
// publishing flag. Other job types are not gated.
const JOB_TYPE_TO_CAPABILITY: Record<string, GatedCapability> = {
  image: "image",
  video: "video",
  publishing: "publishing",
  social: "publishing",
};

/** Returns the gated capability for a job type, or null if it is not gated. */
export function gatedCapabilityFor(jobType: unknown): GatedCapability | null {
  if (typeof jobType !== "string") return null;
  return JOB_TYPE_TO_CAPABILITY[jobType.trim().toLowerCase()] ?? null;
}

export function isCapabilityEnabled(
  capability: GatedCapability,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[CAPABILITY_ENV_VARS[capability]] === "true";
}
