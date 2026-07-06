'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChannelDto,
  ConnectSessionDto,
  ConnectStartResponseDto,
  ConnectionType,
} from '@wolfiax/shared';
import { Facebook, Instagram, RefreshCw, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatDate } from '@/lib/utils';

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Activo', tone: 'agent' },
  token_expired: { label: 'Token vencido', tone: 'analyst' },
  revoked: { label: 'Acceso revocado', tone: 'analyst' },
  disconnected: { label: 'Desconectado', tone: 'neutral' },
  error: { label: 'Error', tone: 'analyst' },
};

export default function ChannelsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      }
    >
      <ChannelsContent />
    </Suspense>
  );
}

function ChannelsContent() {
  const { me } = useAuth();
  const searchParams = useSearchParams();
  const canManage = me?.current_role === 'owner' || me?.current_role === 'admin';

  const connected = searchParams.get('connected') === '1';
  const connectError = searchParams.get('connect_error');
  const connectSession = searchParams.get('connect_session');

  if (!me) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Canales</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Cuentas de Instagram conectadas mediante las APIs oficiales de Meta.
        </p>
      </div>

      {connected && (
        <Alert tone="success">Cuenta de Instagram conectada correctamente. 🎉</Alert>
      )}
      {connectError && (
        <Alert>
          {connectError === 'denied'
            ? 'La autorización fue cancelada o denegada en Meta.'
            : 'La conexión falló. Verifica que la cuenta sea profesional y vuelve a intentar.'}
        </Alert>
      )}

      {connectSession && <AccountSelection sessionId={connectSession} />}

      <ChannelList canManage={canManage} />
      {canManage && <ConnectCard />}
    </div>
  );
}

function ChannelList({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const channels = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<ChannelDto[]>('/channels'),
  });

  const healthCheck = useMutation({
    mutationFn: (id: string) => api.post<ChannelDto>(`/channels/${id}/health-check`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error en la verificación.'),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api.delete(`/channels/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['channels'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al desconectar.'),
  });

  if (channels.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (!channels.data || channels.data.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Cuentas conectadas" />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        <ul className="divide-y divide-neutral-100">
          {channels.data.map((ch) => {
            const status = STATUS_LABELS[ch.status] ?? { label: ch.status, tone: 'neutral' };
            return (
              <li key={ch.id} className="flex items-center gap-4 py-4">
                <Instagram className="size-8 shrink-0 text-pink-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">@{ch.ig_username}</p>
                  <p className="text-xs text-neutral-500">
                    {ch.connection_type === 'instagram_login'
                      ? 'Instagram Login'
                      : 'Facebook Login'}
                    {' · '}
                    webhooks {ch.webhook_subscribed ? 'activos ✓' : 'pendientes ✗'}
                    {ch.token_expires_at && ` · token vence ${formatDate(ch.token_expires_at)}`}
                  </p>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
                {canManage && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Verificar conexión"
                      loading={healthCheck.isPending}
                      onClick={() => healthCheck.mutate(ch.id)}
                    >
                      <RefreshCw className="size-4 text-neutral-400" />
                    </Button>
                    {ch.status !== 'disconnected' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Desconectar"
                        disabled={disconnect.isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `¿Desconectar @${ch.ig_username}? El historial se conserva pero dejarán de llegar mensajes.`,
                            )
                          ) {
                            disconnect.mutate(ch.id);
                          }
                        }}
                      >
                        <Trash2 className="size-4 text-neutral-400 hover:text-red-600" />
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function ConnectCard() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ConnectionType | null>(null);

  async function connect(connection_type: ConnectionType) {
    setError(null);
    setPending(connection_type);
    try {
      const res = await api.post<ConnectStartResponseDto>('/channels/instagram/connect', {
        connection_type,
      });
      window.location.href = res.authorization_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar la conexión.');
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Conectar una cuenta de Instagram"
        description="Requiere una cuenta profesional (Business o Creator) con «Permitir acceso a mensajes» activado en la app de Instagram"
      />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="secondary"
            loading={pending === 'instagram_login'}
            onClick={() => void connect('instagram_login')}
            className="justify-start"
          >
            <Instagram className="size-4 text-pink-600" />
            Con Instagram (recomendado)
          </Button>
          <Button
            variant="secondary"
            loading={pending === 'facebook_login'}
            onClick={() => void connect('facebook_login')}
            className="justify-start"
          >
            <Facebook className="size-4 text-blue-600" />
            Con Facebook (página vinculada)
          </Button>
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          La vía de Instagram no necesita página de Facebook. Usa la de Facebook si tu cuenta ya se
          gestiona desde una página o Business Manager.
        </p>
      </CardBody>
    </Card>
  );
}

function AccountSelection({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const session = useQuery({
    queryKey: ['connect-session', sessionId],
    queryFn: () => api.get<ConnectSessionDto>(`/channels/connect-sessions/${sessionId}`),
    retry: false,
  });

  const select = useMutation({
    mutationFn: (ig_user_id: string) =>
      api.post<ChannelDto>(`/channels/connect-sessions/${sessionId}/select`, { ig_user_id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['channels'] });
      router.replace('/settings/channels?connected=1');
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'No se pudo conectar la cuenta.'),
  });

  if (session.isError) {
    return <Alert>La sesión de conexión expiró. Vuelve a iniciar la conexión.</Alert>;
  }
  if (!session.data) return null;

  return (
    <Card>
      <CardHeader
        title="Elige la cuenta a conectar"
        description="La autorización devolvió varias cuentas de Instagram"
      />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        <ul className="divide-y divide-neutral-100">
          {session.data.candidates.map((c) => (
            <li key={c.ig_user_id} className="flex items-center gap-4 py-3">
              {c.profile_pic_url ? (
                <img
                  src={c.profile_pic_url}
                  alt=""
                  className="size-10 rounded-full object-cover"
                />
              ) : (
                <Instagram className="size-10 rounded-full bg-neutral-100 p-2 text-pink-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">@{c.ig_username}</p>
                {c.fb_page_name && (
                  <p className="text-xs text-neutral-500">Página: {c.fb_page_name}</p>
                )}
              </div>
              <Button
                size="sm"
                loading={select.isPending}
                onClick={() => select.mutate(c.ig_user_id)}
              >
                Conectar
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
