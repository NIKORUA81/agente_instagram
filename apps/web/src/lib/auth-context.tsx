'use client';

import type { AuthResponseDto, MeDto } from '@wolfiax/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAccessToken, tryRefresh } from './api';

interface AuthState {
  /** undefined = bootstrapping; null = sin sesión */
  me: MeDto | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    full_name: string;
    organization_name: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (organizationId: string) => Promise<void>;
  /** Adopta una sesión emitida fuera del contexto (p. ej. aceptar invitación). */
  adoptSession: (auth: AuthResponseDto) => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeDto | null | undefined>(undefined);

  const loadMe = useCallback(async () => {
    const profile = await api.get<MeDto>('/auth/me');
    setMe(profile);
  }, []);

  // Bootstrap: si hay cookie de refresh válida, restaura la sesión
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await tryRefresh();
      if (cancelled) return;
      if (!ok) {
        setMe(null);
        return;
      }
      try {
        await loadMe();
      } catch {
        if (!cancelled) setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const auth = await api.post<AuthResponseDto>('/auth/login', { email, password });
      setAccessToken(auth.access_token);
      await loadMe();
    },
    [loadMe],
  );

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      full_name: string;
      organization_name: string;
    }) => {
      const auth = await api.post<AuthResponseDto>('/auth/register', input);
      setAccessToken(auth.access_token);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setMe(null);
    }
  }, []);

  const switchOrg = useCallback(
    async (organizationId: string) => {
      const auth = await api.post<AuthResponseDto>('/auth/switch-org', {
        organization_id: organizationId,
      });
      setAccessToken(auth.access_token);
      await loadMe();
    },
    [loadMe],
  );

  const adoptSession = useCallback(
    async (auth: AuthResponseDto) => {
      setAccessToken(auth.access_token);
      await loadMe();
    },
    [loadMe],
  );

  return (
    <AuthContext.Provider
      value={{ me, login, register, logout, switchOrg, adoptSession, refreshMe: loadMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
