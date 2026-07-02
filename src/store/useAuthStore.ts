import { create } from 'zustand';

interface User {
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
}

export const useAuthStore = create<AuthState>((set) => ({
  // Mock initial state for development
  user: {
    id: 'usr_1',
    email: 'john.doe@example.com',
    name: 'John Doe',
    role: 'ADMIN',
  },
  isAuthenticated: true,
  isLoading: false,
  
  login: (user) => set({ user, isAuthenticated: true }),
  logout: () => set({ user: null, isAuthenticated: false }),
}));
