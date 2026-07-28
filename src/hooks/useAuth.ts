import { useAuthStore, AUTH_BYPASS } from '@/store/useAuthStore';
import { supabase } from '@/lib/supabase';
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
      .then(({ data: { session }, error }) => {
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
            role: 'ADMIN', // Hardcoded role for now
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
          login({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.name || 'User',
            role: 'ADMIN',
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
