import { useAuthStore } from '@/store/useAuthStore';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';
import type { User } from '@/store/useAuthStore';

export function useAuth() {
  console.log("[Runtime] useAuth hook: Executing");
  const { user, isAuthenticated, isLoading, login, logout, setLoading } = useAuthStore();

  useEffect(() => {
    console.log("[Runtime] useAuth effect: Running initial session check");
    // Initial session check
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      console.log("[Runtime] useAuth: getSession result", { hasSession: !!session, error });
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
