import { useAuthStore, AUTH_BYPASS } from '@/store/useAuthStore';
import { supabase } from '@/lib/supabase';
import { AuthService } from '@/modules/auth/AuthService';
import { useEffect } from 'react';
import type { User } from '@/store/useAuthStore';

export function useAuth() {
  const { user, isAuthenticated, isLoading, login, logout, setLoading } = useAuthStore();

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
  }, [login, logout, setLoading]);

  return { user, isAuthenticated, isLoading, login, logout };
}
