'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PlatformOrgDto,
  PlatformStatsDto,
  PlatformUserDto,
} from '@wolfiax/shared';
import { Ban, Building2, LogIn, PlayCircle, Search, Shield, Trash2, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDate } from '@/lib/utils';

export default function PlatformPage() {
  const { me } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (me && !me.is_platform_admin) router.replace('/dashboard');
  }, [me, router]);

  if (!me || !me.is_platform_admin) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="size-6 text-amber-600" />
        <div>
          <h1 className="text-xl font-semibold">Plataforma</h1>
          <p className="text-sm text-neutral-500">
            Panel de Super Admin de Wolfiax. Todas las acciones quedan auditadas.
          </p>
        </div>
      </div>

      <StatsCards />
      <OrganizationsCard />
      <SuperAdminsCard currentUserId={me.user.id} />
    </div>
  );
}

function StatsCards() {
  const stats = useQuery({
    queryKey: ['platform', 'stats'],
    queryFn: () => api.get<PlatformStatsDto>('/platform/stats'),
  });

  if (stats.isLoading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner />
      </div>
    );
  }
  if (!stats.data) return null;

  const cells: Array<{ label: string; value: number }> = [
    { label: 'Organizaciones', value: stats.data.organizations_total },
    { label: 'Activas', value: stats.data.organizations_active },
    { label: 'Suspendidas', value: stats.data.organizations_suspended },
    { label: 'Usuarios', value: stats.data.users_total },
    { label: 'Super Admins', value: stats.data.platform_admins_total },
    { label: 'Canales activos', value: stats.data.channels_active },
    { label: 'Conversaciones', value: stats.data.conversations_total },
    { label: 'Mensajes', value: stats.data.messages_total },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map((c) => (
        <Card key={c.label}>
          <CardBody className="py-4">
            <p className="text-2xl font-semibold">{c.value.toLocaleString('es')}</p>
            <p className="mt-0.5 text-xs text-neutral-500">{c.label}</p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function OrganizationsCard() {
  const qc = useQueryClient();
  const { impersonate } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const orgs = useQuery({
    queryKey: ['platform', 'orgs', debounced],
    queryFn: () =>
      api.get<PlatformOrgDto[]>(
        `/platform/organizations${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  const suspension = useMutation({
    mutationFn: ({ id, suspended }: { id: string; suspended: boolean }) =>
      api.patch(`/platform/organizations/${id}/suspension`, { suspended }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'orgs'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'stats'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al actualizar.'),
  });

  async function enter(org: PlatformOrgDto) {
    setError(null);
    try {
      await impersonate(org.id);
      router.replace('/inbox');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo entrar a la organización.');
    }
  }

  return (
    <Card>
      <CardHeader
        title="Organizaciones"
        description="Entra a cualquier tenant (impersonación) o suspéndelo"
      />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        <div className="relative mb-4">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar organización…"
            className="pl-8"
          />
        </div>

        {orgs.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}

        {orgs.data && orgs.data.length === 0 && (
          <div className="py-8 text-center text-sm text-neutral-400">
            <Building2 className="mx-auto mb-2 size-8" />
            {debounced ? 'Sin resultados.' : 'No hay organizaciones todavía.'}
          </div>
        )}

        <ul className="divide-y divide-neutral-100">
          {orgs.data?.map((org) => (
            <li key={org.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {org.name}
                  {org.suspended && <Badge tone="analyst">Suspendida</Badge>}
                </p>
                <p className="text-xs text-neutral-500">
                  {org.members_count} miembros · {org.channels_count} canales ·{' '}
                  {org.conversations_count} conversaciones · creada {formatDate(org.created_at)}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void enter(org)}>
                <LogIn className="size-3.5" /> Entrar
              </Button>
              {org.suspended ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => suspension.mutate({ id: org.id, suspended: false })}
                  disabled={suspension.isPending}
                  title="Reactivar"
                >
                  <PlayCircle className="size-4 text-emerald-600" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (confirm(`¿Suspender «${org.name}»? Sus usuarios no podrán acceder.`)) {
                      suspension.mutate({ id: org.id, suspended: true });
                    }
                  }}
                  disabled={suspension.isPending}
                  title="Suspender"
                >
                  <Ban className="size-4 text-neutral-400 hover:text-red-600" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function SuperAdminsCard({ currentUserId }: { currentUserId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const admins = useQuery({
    queryKey: ['platform', 'super-admins'],
    queryFn: () => api.get<PlatformUserDto[]>('/platform/super-admins'),
  });

  const promote = useMutation({
    mutationFn: () => api.post('/platform/super-admins', { email }),
    onSuccess: () => {
      setEmail('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['platform', 'super-admins'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'stats'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo promover.'),
  });

  const demote = useMutation({
    mutationFn: (userId: string) => api.delete(`/platform/super-admins/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['platform', 'super-admins'] });
      void qc.invalidateQueries({ queryKey: ['platform', 'stats'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'No se pudo revocar.'),
  });

  return (
    <Card>
      <CardHeader
        title="Super Admins"
        description="Staff de Wolfiax con control total. El usuario debe estar registrado para poder promoverlo."
      />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        <form
          className="mb-4 flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            promote.mutate();
          }}
        >
          <div className="flex-1">
            <Label htmlFor="promote-email">Promover por email</Label>
            <Input
              id="promote-email"
              type="email"
              required
              placeholder="persona@wolfiax.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" loading={promote.isPending}>
            <UserPlus className="size-4" /> Promover
          </Button>
        </form>

        <ul className="divide-y divide-neutral-100">
          {admins.data?.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-3">
              <Shield className="size-4 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {a.full_name}
                  {a.id === currentUserId && (
                    <span className="ml-2 text-xs text-neutral-400">(tú)</span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {a.email} · último acceso{' '}
                  {a.last_login_at ? formatDate(a.last_login_at) : 'nunca'}
                </p>
              </div>
              {a.id !== currentUserId && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revocar Super Admin a ${a.email}`}
                  disabled={demote.isPending}
                  onClick={() => {
                    if (confirm(`¿Revocar el rol de Super Admin a ${a.email}?`)) {
                      demote.mutate(a.id);
                    }
                  }}
                >
                  <Trash2 className="size-4 text-neutral-400 hover:text-red-600" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
