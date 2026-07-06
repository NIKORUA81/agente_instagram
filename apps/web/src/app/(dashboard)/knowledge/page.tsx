'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogItemDto,
  KnowledgeSourceDto,
  KnowledgeSourceType,
} from '@wolfiax/shared';
import { FileText, Globe, Package, RefreshCw, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const STATUS: Record<string, { label: string; tone: string }> = {
  processing: { label: 'Procesando…', tone: 'analyst' },
  ready: { label: 'Listo', tone: 'agent' },
  failed: { label: 'Error', tone: 'analyst' },
  pending: { label: 'Pendiente', tone: 'neutral' },
};

export default function KnowledgePage() {
  const { me } = useAuth();
  const canManage = me?.current_role === 'owner' || me?.current_role === 'admin';
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Base de conocimiento</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Alimenta a la IA con la información de tu negocio. Solo responderá con lo que cargues aquí.
        </p>
      </div>
      <SourcesCard canManage={canManage} />
      <CatalogCard canManage={canManage} />
    </div>
  );
}

function SourcesCard({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['knowledge', 'sources'],
    queryFn: () => api.get<KnowledgeSourceDto[]>('/knowledge/sources'),
    refetchInterval: (q) =>
      (q.state.data ?? []).some((s) => s.status === 'processing') ? 3000 : false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge/sources/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['knowledge', 'sources'] }),
  });
  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/knowledge/sources/${id}/refresh`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['knowledge', 'sources'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Error al re-procesar.'),
  });

  return (
    <Card>
      <CardHeader title="Fuentes" description="Documentos, páginas web y textos" />
      <CardBody>
        {error && <Alert className="mb-4">{error}</Alert>}
        {canManage && <AddSourceForm onError={setError} />}
        {sources.isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        <ul className="mt-2 divide-y divide-neutral-100">
          {sources.data?.map((s) => {
            const st = STATUS[s.status] ?? { label: s.status, tone: 'neutral' };
            const Icon = s.type === 'url' ? Globe : FileText;
            return (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <Icon className="size-5 shrink-0 text-neutral-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-neutral-500">
                    {s.type.toUpperCase()} · {s.chunk_count} fragmentos
                    {s.error && <span className="text-red-600"> · {s.error}</span>}
                  </p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
                {canManage && (
                  <>
                    {s.type === 'url' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Re-procesar"
                        loading={refresh.isPending}
                        onClick={() => refresh.mutate(s.id)}
                      >
                        <RefreshCw className="size-4 text-neutral-400" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Eliminar ${s.name}`}
                      onClick={() => {
                        if (confirm(`¿Eliminar la fuente "${s.name}"?`)) remove.mutate(s.id);
                      }}
                    >
                      <Trash2 className="size-4 text-neutral-400 hover:text-red-600" />
                    </Button>
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

function AddSourceForm({ onError }: { onError: (m: string | null) => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<KnowledgeSourceType>('text');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { type, name };
      if (type === 'url') body.url = url;
      else if (['text', 'faq', 'policy'].includes(type)) body.text = text;
      else if (file) {
        body.content_base64 = await fileToBase64(file);
        body.name = name || file.name;
      }
      return api.post<KnowledgeSourceDto>('/knowledge/sources', body);
    },
    onSuccess: () => {
      setName('');
      setText('');
      setUrl('');
      setFile(null);
      onError(null);
      void qc.invalidateQueries({ queryKey: ['knowledge', 'sources'] });
    },
    onError: (err) => onError(err instanceof ApiError ? err.message : 'No se pudo crear la fuente.'),
  });

  const isFile = ['pdf', 'docx', 'xlsx'].includes(type);
  const isText = ['text', 'faq', 'policy'].includes(type);

  return (
    <form
      className="mb-4 space-y-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="src-type">Tipo</Label>
          <Select
            id="src-type"
            value={type}
            onChange={(e) => setType(e.target.value as KnowledgeSourceType)}
            className="w-full"
          >
            <option value="text">Texto</option>
            <option value="faq">Preguntas frecuentes</option>
            <option value="policy">Políticas</option>
            <option value="url">Página web (URL)</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word (DOCX)</option>
            <option value="xlsx">Excel (XLSX)</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="src-name">Nombre</Label>
          <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} required={!isFile} />
        </div>
      </div>
      {isText && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Pega aquí el texto (horarios, políticas, FAQ…)"
          className="w-full resize-none rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline focus:outline-2 focus:outline-brand-100"
        />
      )}
      {type === 'url' && (
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://tunegocio.com/preguntas-frecuentes"
        />
      )}
      {isFile && (
        <input
          type="file"
          accept={type === 'pdf' ? '.pdf' : type === 'docx' ? '.docx' : '.xlsx'}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
        />
      )}
      <Button type="submit" loading={create.isPending}>
        <Upload className="size-4" /> Añadir fuente
      </Button>
    </form>
  );
}

function CatalogCard({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [desc, setDesc] = useState('');

  const items = useQuery({
    queryKey: ['catalog'],
    queryFn: () => api.get<CatalogItemDto[]>('/catalog/items'),
  });
  const create = useMutation({
    mutationFn: () =>
      api.post('/catalog/items', {
        name,
        description: desc || null,
        price: price ? Number(price) : null,
      }),
    onSuccess: () => {
      setName('');
      setPrice('');
      setDesc('');
      void qc.invalidateQueries({ queryKey: ['catalog'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/catalog/items/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['catalog'] }),
  });

  return (
    <Card>
      <CardHeader
        title="Catálogo"
        description="Productos y servicios (se indexan para que la IA responda precios y disponibilidad)"
      />
      <CardBody>
        {canManage && (
          <form
            className="mb-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="min-w-40 flex-1">
              <Label htmlFor="prod-name">Producto</Label>
              <Input id="prod-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="w-28">
              <Label htmlFor="prod-price">Precio</Label>
              <Input
                id="prod-price"
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="min-w-40 flex-1">
              <Label htmlFor="prod-desc">Descripción</Label>
              <Input id="prod-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
            </div>
            <Button type="submit" loading={create.isPending}>
              Añadir
            </Button>
          </form>
        )}
        {items.data && items.data.length === 0 && (
          <p className="py-6 text-center text-sm text-neutral-400">
            <Package className="mx-auto mb-2 size-8" />
            Sin productos todavía.
          </p>
        )}
        <ul className="divide-y divide-neutral-100">
          {items.data?.map((i) => (
            <li key={i.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{i.name}</p>
                {i.description && <p className="truncate text-xs text-neutral-500">{i.description}</p>}
              </div>
              {i.price !== null && (
                <span className="text-sm font-medium text-neutral-700">
                  {i.price} {i.currency}
                </span>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Eliminar ${i.name}`}
                  onClick={() => remove.mutate(i.id)}
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
