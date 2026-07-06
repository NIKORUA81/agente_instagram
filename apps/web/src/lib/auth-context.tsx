'use client';

import type { AuthResponseDto, ImpersonateResponseDto, MeDto } from '@wolfiax/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAccessToken, tryRefresh } from './api';

interface AuthState {
  /** undefined = bootstrapping; null = sin sesión */
  me: MeDto | null | undefined;
  /** true mientras un Super Admin opera dentro de un tenant impersonado */
  impersonating: boolean;
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
  /** Super Admin: entra a un tenant con un token de impersonación. */
  impersonate: (organizationId: string) => Promise<void>;
  /** Vuelve a la sesión propia del Super Admin. */
  stopImpersonation: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<MeDto | null | undefined>(undefined);
  const [impersonating, setImpersonating] = useState(false);

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

  const impersonate = useCallback(
    async (organizationId: string) => {
      const res = await api.post<ImpersonateResponseDto>(
        `/platform/organizations/${organizationId}/impersonate`,
      );
      setAccessToken(res.access_token);
      setImpersonating(true);
      await loadMe();
    },
    [loadMe],
  );

  const stopImpersonation = useCallback(async () => {
    // La cookie de refresh sigue apuntando a la sesión propia del Super Admin
    const ok = await tryRefresh();
    setImpersonating(false);
    if (ok) {
      await loadMe();
    } else {
      setMe(null);
    }
  }, [loadMe]);

  return (
    <AuthContext.Provider
      value={{
        me,
        impersonating,
        login,
        register,
        logout,
        switchOrg,
        adoptSession,
        impersonate,
        stopImpersonation,
        refreshMe: loadMe,
      }}
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
