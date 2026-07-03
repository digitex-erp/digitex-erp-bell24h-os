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

console.log("[Runtime] useAuthStore: Module loaded");
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  
  login: (user) => {
    console.log("[Runtime] useAuthStore: login called", user.email);
    set({ user, isAuthenticated: true, isLoading: false });
  },
  logout: () => {
    console.log("[Runtime] useAuthStore: logout called");
    set({ user: null, isAuthenticated: false, isLoading: false });
  },
  setLoading: (isLoading) => {
    console.log("[Runtime] useAuthStore: setLoading called", isLoading);
    set({ isLoading });
  },
}));
