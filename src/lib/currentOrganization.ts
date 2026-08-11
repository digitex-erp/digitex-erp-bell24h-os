/**
 * Resolves the organization_id of the currently signed-in user directly from the
 * authenticated Supabase session — never from caller-supplied input.
 *
 * BR-03: extracted from the existing inline pattern already used four times in
 * `src/pages/AiProvidersPage.tsx` and independently re-implemented per-page in
 * ContentPlannerPage.tsx, VideoStudioPage.tsx, ImageStudioPage.tsx, JobOrchestratorPage.tsx,
 * and TeamPage.tsx (`profiles.organization_id` filtered by the authenticated user's id).
 * This is not a new tenancy mechanism — it is the same table, column, and RLS policy
 * those call sites already rely on, factored into one place so service classes that have
 * no React hook access (and therefore can't call `useAuthStore()`) can resolve the same
 * trusted context instead of going without it or duplicating the query a third time.
 *
 * This has no relationship to `server/middleware/requireAuth.ts`. That resolves tenant
 * context for requests that pass through the Express server; nothing described here does
 * — these are direct browser→Supabase calls, and the trust boundary is the authenticated
 * Supabase session plus RLS, same as every other client-side query in this app.
 */

import { supabase } from "@/lib/supabase";

/**
 * Returns the organization_id of the signed-in user, or null if there is no
 * authenticated session or the user's profile has no organization set. Never throws —
 * callers must decide how to handle a null result (typically: refuse to proceed rather
 * than fall back to an unfiltered query).
 */
export async function getCurrentOrganizationId(): Promise<string | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile?.organization_id) return null;
  return profile.organization_id;
}
