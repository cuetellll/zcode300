import { create } from 'zustand';
import type { PublicUser } from '../lib/types';

/**
 * Access token lives in memory ONLY (never localStorage). The refresh token
 * is an HttpOnly cookie handled by the server; `refresh()` returns a new
 * access token on boot and on 401s.
 */

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  status: 'loading' | 'authed' | 'guest';
  setSession: (user: PublicUser, accessToken: string) => void;
  setToken: (accessToken: string) => void;
  setUser: (user: PublicUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  status: 'loading',
  setSession: (user, accessToken) => set({ user, accessToken, status: 'authed' }),
  setToken: (accessToken) => set({ accessToken }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null, status: 'guest' }),
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
