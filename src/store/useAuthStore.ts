import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'EDITOR' | 'VIEWER';
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  // A Supabase PASSWORD_RECOVERY session is intentionally kept separate from
  // isAuthenticated: it must authorize only the /auth/update-password flow
  // (see App.tsx's AuthRedirect), never a normal application login.
  isPasswordRecovery: boolean;
  login: (user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setPasswordRecovery: (value: boolean) => void;
}

// TEMPORARY DEVELOPMENT AUTH BYPASS
//
// Requires BOTH conditions:
//   1. import.meta.env.DEV — statically false in `vite build` output, so the
//      bypass can never reach a production bundle.
//   2. VITE_AUTH_BYPASS === 'true' — explicit opt-in, so the real Supabase
//      login flow is reachable in dev/preview by default.
//
// Condition 2 exists because the AI Studio preview runs `npm run dev`, where
// DEV is always true. Without an opt-in the bypass auto-authenticated as
// 'dev-user-id', which is not a UUID and matches no profiles row — making the
// login page unreachable and 404ing every organization-scoped query.
export const AUTH_BYPASS =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_BYPASS === 'true';

const devUser: User = {
  id: 'dev-user-id',
  email: 'developer@bell24h.os',
  name: 'Developer Admin',
  role: 'ADMIN',
};

export const useAuthStore = create<AuthState>((set) => ({
  user: AUTH_BYPASS ? devUser : null,
  isAuthenticated: AUTH_BYPASS,
  isLoading: !AUTH_BYPASS,
  isPasswordRecovery: false,

  login: (user) => {
    set({ user, isAuthenticated: true, isLoading: false });
  },
  logout: () => {
    if (AUTH_BYPASS) {
      // TEMPORARY DEVELOPMENT AUTH BYPASS: Logout disabled
      console.log("Logout disabled in development mode");
      return;
    }
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (isLoading) => {
    set({ isLoading });
  },
  setPasswordRecovery: (isPasswordRecovery) => {
    set({ isPasswordRecovery });
  },
}));
