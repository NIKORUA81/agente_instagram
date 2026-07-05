'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    organization_name: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password.length < 10) {
      setError('La contraseña debe tener al menos 10 caracteres.');
      return;
    }
    setSubmitting(true);
    try {
      await register(form);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la cuenta.');
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody className="py-6">
        <h1 className="mb-1 text-lg font-semibold">Crea tu cuenta</h1>
        <p className="mb-6 text-sm text-neutral-500">
          Tu organización se crea contigo como propietario.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="full_name">Tu nombre</Label>
            <Input
              id="full_name"
              required
              autoComplete="name"
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="organization_name">Nombre de tu empresa</Label>
            <Input
              id="organization_name"
              required
              value={form.organization_name}
              onChange={(e) => set('organization_name', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
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
              onChange={(e) => set('password', e.target.value)}
            />
          </div>
          <Button type="submit" loading={submitting} className="w-full">
            Crear cuenta
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-neutral-500">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Inicia sesión
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
