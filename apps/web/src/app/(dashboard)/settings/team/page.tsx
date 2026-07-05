'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InvitationDto, MemberDto, Role } from '@wolfiax/shared';
import { Copy, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDate, ROLE_LABELS } from '@/lib/utils';

export default function TeamPage() {
  const { me } = useAuth();
  if (!me) return null;

  const orgId = me.current_organization.id;
  const canManage = me.current_role === 'owner' || me.current_role === 'admin';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Equipo</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Miembros e invitaciones de {me.current_organization.name}.
        </p>
      </div>
      <MembersCard orgId={orgId} canManage={canManage} currentUserId={me.user.id} />
      {canManage && <InvitationsCard orgId={orgId} />}
    </div>
  );
}

function MembersCard({
  orgId,
  canManage,
  currentUserId,
}: {
  orgId: string;
  canManage: boolean;
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => api.get<MemberDto[]>(`/orgs/${orgId}/members`),
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Role }) =>
      api.patch(`/orgs/${orgId}/members/${userId}`, { role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members', orgId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al cambiar el rol.'),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/orgs/${orgId}/members/${userId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['members', orgId] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al quitar miembro.'),
  });

  return (
    <Card>
      <CardHeader title="Miembros" description="Personas con acceso a esta organización" />
      <CardBody>
        {error && (
          <Alert className="mb-4">
            {error}{' '}
            <button className="font-medium underline" onClick={() => setError(null)}>
              cerrar
            </button>
          </Alert>
        )}
        {members.isLoading && <p className="text-sm text-neutral-500">Cargando…</p>}
        {members.isError && <Alert>No se pudo cargar la lista de miembros.</Alert>}
        <ul className="divide-y divide-neutral-100">
          {members.data?.map((m) => (
            <li key={m.user_id} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.full_name}
                  {m.user_id === currentUserId && (
                    <span className="ml-2 text-xs text-neutral-400">(tú)</span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-500">{m.email}</p>
              </div>
              {canManage && m.user_id !== currentUserId ? (
                <>
                  <Select
                    value={m.role}
                    className="h-8 text-xs"
                    disabled={changeRole.isPending}
                    onChange={(e) =>
                      changeRole.mutate({ userId: m.user_id, role: e.target.value as Role })
                    }
                  >
                    {(['owner', 'admin', 'agent', 'analyst'] as const).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Quitar a ${m.full_name}`}
                    disabled={remove.isPending}
                    onClick={() => {
                      if (confirm(`¿Quitar a ${m.full_name} de la organización?`)) {
                        remove.mutate(m.user_id);
                      }
                    }}
                  >
                    <Trash2 className="size-4 text-neutral-400 hover:text-red-600" />
                  </Button>
                </>
              ) : (
                <Badge tone={m.role}>{ROLE_LABELS[m.role]}</Badge>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function InvitationsCard({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'agent' | 'analyst'>('agent');
  const [error, setError] = useState<string | null>(null);
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const invitations = useQuery({
    queryKey: ['invitations', orgId],
    queryFn: () => api.get<InvitationDto[]>(`/orgs/${orgId}/invitations`),
  });

  const create = useMutation({
    mutationFn: () => api.post<InvitationDto>(`/orgs/${orgId}/invitations`, { email, role }),
    onSuccess: (inv) => {
      setEmail('');
      setLastUrl(inv.accept_url ?? null);
      setCopied(false);
      void qc.invalidateQueries({ queryKey: ['invitations', orgId] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la invitación.'),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/orgs/${orgId}/invitations/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['invitations', orgId] }),
  });

  async function copyUrl() {
    if (!lastUrl) return;
    await navigator.clipboard.writeText(lastUrl);
    setCopied(true);
  }

  return (
    <Card>
      <CardHeader
        title="Invitaciones"
        description="El enlace de invitación se comparte manualmente (el envío por email llega en una fase posterior)"
      />
      <CardBody>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <div className="min-w-52 flex-1">
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              required
              placeholder="colega@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="inv-role">Rol</Label>
            <Select
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              <option value="admin">Administrador</option>
              <option value="agent">Agente</option>
              <option value="analyst">Analista</option>
            </Select>
          </div>
          <Button type="submit" loading={create.isPending}>
            <UserPlus className="size-4" />
            Invitar
          </Button>
        </form>

        {error && <Alert className="mt-4">{error}</Alert>}

        {lastUrl && (
          <Alert tone="success" className="mt-4">
            <p className="font-medium">Invitación creada. Comparte este enlace:</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white/60 px-2 py-1 text-xs">
                {lastUrl}
              </code>
              <Button type="button" variant="secondary" size="sm" onClick={() => void copyUrl()}>
                <Copy className="size-3.5" />
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
          </Alert>
        )}

        {invitations.data && invitations.data.length > 0 && (
          <ul className="mt-6 divide-y divide-neutral-100 border-t border-neutral-100">
            {invitations.data.map((inv) => (
              <li key={inv.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-neutral-500">
                    {ROLE_LABELS[inv.role]} · expira {formatDate(inv.expires_at)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Revocar invitación a ${inv.email}`}
                  onClick={() => revoke.mutate(inv.id)}
                  disabled={revoke.isPending}
                >
                  <Trash2 className="size-4 text-neutral-400 hover:text-red-600" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
