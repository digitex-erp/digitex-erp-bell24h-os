import { supabase } from "@/lib/supabase";

export class AuthService {
  static async getUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
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
