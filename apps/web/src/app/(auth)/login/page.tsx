'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { me, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (me) router.replace('/dashboard');
  }, [me, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardBody className="py-6">
        <h1 className="mb-6 text-lg font-semibold">Iniciar sesión</h1>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="password">Contraseña</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button type="submit" loading={submitting} className="w-full">
            Entrar
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-neutral-500">
          ¿No tienes cuenta?{' '}
          <Link href="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Crea tu organización
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
