'use client';

import { useQuery } from '@tanstack/react-query';
import type { ContactDto, PaginatedDto } from '@wolfiax/shared';
import { Search, Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';

type ContactRow = ContactDto & { conversation_id: string | null };

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const contacts = useQuery({
    queryKey: ['contacts', debounced],
    queryFn: () =>
      api.get<PaginatedDto<ContactRow>>(
        `/contacts${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`,
      ),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Contactos</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Personas que han escrito a tus cuentas conectadas.
        </p>
      </div>

      <Card>
        <CardHeader title="Directorio" />
        <CardBody>
          <div className="relative mb-4">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o usuario…"
              className="pl-8"
            />
          </div>

          {contacts.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}

          {contacts.data && contacts.data.items.length === 0 && (
            <div className="py-10 text-center text-sm text-neutral-400">
              <Users className="mx-auto mb-2 size-8" />
              {debounced ? 'Sin resultados.' : 'Aún no hay contactos.'}
            </div>
          )}

          <ul className="divide-y divide-neutral-100">
            {contacts.data?.items.map((c) => {
              const name = c.username ? `@${c.username}` : (c.name ?? c.ig_scoped_id);
              const inner = (
                <>
                  {c.profile_pic_url ? (
                    <img src={c.profile_pic_url} alt="" className="size-9 rounded-full object-cover" />
                  ) : (
                    <div className="flex size-9 items-center justify-center rounded-full bg-neutral-100 text-sm font-semibold text-neutral-500">
                      {name.replace('@', '').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    {c.name && c.username && (
                      <p className="truncate text-xs text-neutral-500">{c.name}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-neutral-400">
                    visto {formatDate(c.last_seen_at)}
                  </span>
                </>
              );
              return (
                <li key={c.id}>
                  {c.conversation_id ? (
                    <Link
                      href="/inbox"
                      className="flex items-center gap-3 py-3 transition-colors hover:bg-neutral-50"
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-3">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
