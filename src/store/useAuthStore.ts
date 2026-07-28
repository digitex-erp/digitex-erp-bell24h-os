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
  login: (user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

// TEMPORARY DEVELOPMENT AUTH BYPASS
// Gated on import.meta.env.DEV: true under `vite dev`, statically false in
// `vite build` output, so the bypass cannot reach a production bundle.
export const AUTH_BYPASS = import.meta.env.DEV;

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
}));
