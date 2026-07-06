'use client';

import {
  BarChart3,
  BookOpen,
  Bot,
  Inbox,
  Instagram,
  LogOut,
  Settings,
  Shield,
  Users,
  Workflow,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { cn, ROLE_LABELS } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Inicio', icon: BarChart3, enabled: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox, enabled: true },
  { href: '/contacts', label: 'Contactos', icon: Users, enabled: true },
  { href: '/automations', label: 'Automatizaciones', icon: Zap, enabled: true },
  { href: '/knowledge', label: 'Conocimiento', icon: BookOpen, enabled: true },
  { href: '/settings/ai', label: 'IA', icon: Bot, enabled: true },
  { href: '/flows', label: 'Flujos', icon: Workflow, enabled: false, phase: 'F4' },
  { href: '/settings/channels', label: 'Canales', icon: Instagram, enabled: true },
  { href: '/settings/team', label: 'Equipo', icon: Settings, enabled: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { me, logout, switchOrg, impersonating, stopImpersonation } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (me === null) router.replace('/login');
  }, [me, router]);

  if (me === undefined || me === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-screen', impersonating && 'pt-7')}>
      {impersonating && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
          <Shield className="size-3.5" />
          Estás operando como Super Admin dentro de «{me.current_organization.name}».
          <button
            onClick={() => void stopImpersonation().then(() => router.replace('/platform'))}
            className="rounded bg-amber-950/10 px-2 py-0.5 font-semibold hover:bg-amber-950/20"
          >
            Salir de impersonación
          </button>
        </div>
      )}
      <aside className="flex w-64 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-5 py-4">
          <p className="text-sm font-bold tracking-tight">
            WOLFIAX <span className="text-brand-600">SOCIAL AI</span>
          </p>
          {me.organizations.length > 1 ? (
            <select
              className="mt-2 w-full rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs"
              value={me.current_organization.id}
              onChange={(e) => void switchOrg(e.target.value)}
            >
              {me.organizations.map((m) => (
                <option key={m.organization.id} value={m.organization.id}>
                  {m.organization.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="mt-1 truncate text-xs text-neutral-500">{me.current_organization.name}</p>
          )}
        </div>

        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            if (!item.enabled) {
              return (
                <div
                  key={item.href}
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-400"
                  title={`Disponible en fase ${item.phase}`}
                >
                  <Icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium">
                    {item.phase}
                  </span>
                </div>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}

          {me.is_platform_admin && (
            <>
              <div className="my-2 border-t border-neutral-100" />
              <Link
                href="/platform"
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  pathname.startsWith('/platform')
                    ? 'bg-amber-50 text-amber-700'
                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900',
                )}
              >
                <Shield className="size-4" />
                Plataforma
              </Link>
            </>
          )}
        </nav>

        <div className="border-t border-neutral-100 p-4">
          <p className="truncate text-sm font-medium text-neutral-800">{me.user.full_name}</p>
          <p className="truncate text-xs text-neutral-500">
            {me.user.email} · {ROLE_LABELS[me.current_role]}
          </p>
          <button
            onClick={() => {
              void logout().then(() => router.replace('/login'));
            }}
            className="mt-3 flex items-center gap-2 text-xs font-medium text-neutral-500 hover:text-red-600"
          >
            <LogOut className="size-3.5" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
    </div>
  );
}
