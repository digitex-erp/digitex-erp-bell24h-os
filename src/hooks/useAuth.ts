import { useAuthStore } from '@/store/useAuthStore';
import { supabase } from '@/lib/supabase';
import { useEffect } from 'react';

export function useAuth() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuthStore();

  // Placeholder for real supabase auth listener
  useEffect(() => {
    // const { data: { subscription } } = supabase.auth.onAuthStateChange(
    //   (event, session) => {
    //     if (session?.user) {
    //       login({ ...session.user, role: 'VIEWER' } as any);
    //     } else {
    //       logout();
    //     }
    //   }
    // );
    // return () => subscription.unsubscribe();
  }, [login, logout]);

  return { user, isAuthenticated, isLoading, login, logout };
}
