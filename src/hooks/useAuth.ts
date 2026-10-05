import { useAuthStore, AUTH_BYPASS } from '@/store/useAuthStore';
import { supabase } from '@/lib/supabase';
import { AuthService } from '@/modules/auth/AuthService';
import { useEffect } from 'react';
import type { User } from '@/store/useAuthStore';

// Mirrors AuthPage.tsx's own recovery-link detection (type=recovery / code
// param on /auth/update-password). Needed here too because a GoTrueClient
// listener registered from a React effect runs after the client's own
// detectSessionInUrl handling already ran — it sees an INITIAL_SESSION event
// with the recovery session already established, not a PASSWORD_RECOVERY
// event (see @supabase/auth-js GoTrueClient's _emitInitialSession). Checking
// the URL directly makes the recovery check correct regardless of that
// event-listener-registration race.
function isPasswordRecoveryUrl(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.location.pathname.includes('update-password')) return false;
  const params = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.substring(1));
  return params.get('type') === 'recovery' || hash.get('type') === 'recovery' || params.has('code');
}

export function useAuth() {
  const { user, isAuthenticated, isLoading, login, logout, setLoading, setPasswordRecovery } = useAuthStore();

  useEffect(() => {
    // TEMPORARY DEVELOPMENT AUTH BYPASS
    // Skip Supabase session checks to maintain mock authenticated state.
    // Gated on AUTH_BYPASS so production builds run the real auth path below.
    if (AUTH_BYPASS) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession()
      .then(async ({ data: { session }, error }) => {
        if (error) {
          console.error("Auth Session Error:", error);
          logout();
          setLoading(false);
          return;
        }

        // A password-recovery session must not establish a normal application
        // login — AuthPage.tsx owns this session for the update-password flow
        // only (see App.tsx's AuthRedirect, which checks isPasswordRecovery).
        if (isPasswordRecoveryUrl()) {
          setPasswordRecovery(true);
          setLoading(false);
          return;
        }

        if (session?.user) {
          login({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.name || 'User',
            role: await AuthService.resolveRole(session.user.id),
          });
        } else {
          logout();
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Auth Session Promise Rejected:", err);
        logout();
        setLoading(false);
      });

    // Listener for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const recovering = event === 'PASSWORD_RECOVERY' || isPasswordRecoveryUrl();
        setPasswordRecovery(recovering);
        if (recovering) {
          return;
        }

        if (session?.user) {
          const sessionUser = session.user;
          AuthService.resolveRole(sessionUser.id).then((role) => {
            login({
              id: sessionUser.id,
              email: sessionUser.email || '',
              name: sessionUser.user_metadata?.name || 'User',
              role,
            });
          });
        } else {
          logout();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [login, logout, setLoading, setPasswordRecovery]);

  return { user, isAuthenticated, isLoading, login, logout };
}
