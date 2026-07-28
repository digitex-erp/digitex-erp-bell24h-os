import { supabase } from "@/lib/supabase";
import type { User } from "@/store/useAuthStore";

type AppRole = User["role"];

const KNOWN_ROLES: AppRole[] = ["ADMIN", "MANAGER", "EDITOR", "VIEWER"];

/**
 * Least-privilege default. Used whenever a role cannot be resolved, per
 * SECURITY_BASELINE.md — "Fail closed when identity, organization, or
 * authorization cannot be resolved."
 */
const DEFAULT_ROLE: AppRole = "VIEWER";

/** Rank used to pick the strongest role when a user holds several. */
const ROLE_RANK: Record<AppRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  MANAGER: 2,
  ADMIN: 3,
};

export class AuthService {
  static async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  }

  /**
   * Resolve the signed-in user's application role from `user_roles` -> `roles`.
   *
   * NOTE: this drives UI affordances only. Frontend visibility is not authorization —
   * server-side and RLS enforcement remain required for every privileged action.
   */
  static async resolveRole(userId: string): Promise<AppRole> {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("roles(name)")
        .eq("user_id", userId);

      if (error) {
        console.warn("[Auth] Role lookup failed; defaulting to least privilege.", error.message);
        return DEFAULT_ROLE;
      }

      const names = (data ?? [])
        .flatMap((row: any) => (Array.isArray(row.roles) ? row.roles : [row.roles]))
        .map((r: any) => String(r?.name ?? "").trim().toUpperCase())
        .filter((name): name is AppRole => (KNOWN_ROLES as string[]).includes(name));

      if (names.length === 0) return DEFAULT_ROLE;

      return names.reduce((strongest, current) =>
        ROLE_RANK[current] > ROLE_RANK[strongest] ? current : strongest,
      );
    } catch (err: any) {
      console.warn("[Auth] Role lookup threw; defaulting to least privilege.", err?.message);
      return DEFAULT_ROLE;
    }
  }

  static async signOut() {
    await supabase.auth.signOut();
  }

  // Placeholder for advanced SSO, OAuth, SAML
  static async signInWithGoogle() {
    return supabase.auth.signInWithOAuth({
      provider: 'google',
    });
  }

  static async signInWithEmail(email: string) {
    return supabase.auth.signInWithOtp({
      email,
    });
  }
}
