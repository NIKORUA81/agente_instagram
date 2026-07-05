'use client';

import type { AuthResponseDto, InvitationPublicDto } from '@wolfiax/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ROLE_LABELS } from '@/lib/utils';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { me, adoptSession } = useAuth();

  const [invitation, setInvitation] = useState<InvitationPublicDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ full_name: '', password: '' });

  useEffect(() => {
    api
      .get<InvitationPublicDto>(`/auth/invitations/${token}`)
      .then(setInvitation)
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.message : 'Invitación no válida.'),
      );
  }, [token]);

  async function accept(body: { full_name?: string; password?: string }) {
    setError(null);
    setSubmitting(true);
    try {
      const auth = await api.post<AuthResponseDto>(`/auth/invitations/${token}/accept`, body);
      await adoptSession(auth);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo aceptar la invitación.');
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Card>
        <CardBody className="py-8 text-center">
          <Alert>{loadError}</Alert>
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand-600">
            Ir a iniciar sesión
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (!invitation) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const roleLabel = ROLE_LABELS[invitation.role] ?? invitation.role;

  return (
    <Card>
      <CardBody className="py-6">
        <h1 className="mb-1 text-lg font-semibold">Invitación a {invitation.organization_name}</h1>
        <p className="mb-6 text-sm text-neutral-500">
          {invitation.email} · rol: {roleLabel}
        </p>
        {error && <Alert className="mb-4">{error}</Alert>}

        {invitation.account_exists ? (
          me?.user.email === invitation.email ? (
            <Button className="w-full" loading={submitting} onClick={() => accept({})}>
              Unirme a {invitation.organization_name}
            </Button>
          ) : (
            <div className="space-y-4">
              <Alert tone="info">
                Este email ya tiene una cuenta. Inicia sesión con {invitation.email} y vuelve a
                abrir este enlace para aceptar la invitación.
              </Alert>
              <Link href="/login">
                <Button variant="secondary" className="w-full">
                  Ir a iniciar sesión
                </Button>
              </Link>
            </div>
          )
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void accept(form);
            }}
          >
            <div>
              <Label htmlFor="full_name">Tu nombre</Label>
              <Input
                id="full_name"
                required
                value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="password">Contraseña (mínimo 10 caracteres)</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <Button type="submit" loading={submitting} className="w-full">
              Crear cuenta y unirme
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
