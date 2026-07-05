'use client';

import { Instagram, Rocket, Users } from 'lucide-react';
import Link from 'next/link';
import { Card, CardBody } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';

export default function DashboardHome() {
  const { me } = useAuth();
  if (!me) return null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-semibold">Hola, {me.user.full_name.split(' ')[0]} 👋</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Bienvenido a {me.current_organization.name}. Esto es lo que puedes hacer hoy:
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody className="py-5">
            <Users className="mb-3 size-6 text-brand-600" />
            <h2 className="text-sm font-semibold">Invita a tu equipo</h2>
            <p className="mt-1 text-sm text-neutral-500">
              Agrega administradores, agentes y analistas con permisos separados.
            </p>
            <Link
              href="/settings/team"
              className="mt-3 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Gestionar equipo →
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="py-5">
            <Instagram className="mb-3 size-6 text-neutral-400" />
            <h2 className="text-sm font-semibold text-neutral-500">Conecta Instagram</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Disponible en la fase F1: conexión OAuth oficial con Meta, inbox en tiempo real.
            </p>
          </CardBody>
        </Card>

        <Card className="sm:col-span-2">
          <CardBody className="flex items-center gap-4 py-5">
            <Rocket className="size-6 shrink-0 text-brand-600" />
            <div>
              <h2 className="text-sm font-semibold">Fase actual: F0 — Fundaciones</h2>
              <p className="mt-0.5 text-sm text-neutral-500">
                Multi-tenancy, autenticación segura y gestión de equipo ya están operativos. Las
                próximas fases habilitan la conexión con Meta, el inbox y la IA.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
