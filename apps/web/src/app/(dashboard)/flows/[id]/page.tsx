'use client';

import { useQuery } from '@tanstack/react-query';
import type { FlowDto } from '@wolfiax/shared';
import { useParams } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { FlowEditor } from './editor';

export default function FlowEditorPage() {
  const params = useParams<{ id: string }>();
  const flow = useQuery({
    queryKey: ['flow', params.id],
    queryFn: () => api.get<FlowDto>(`/flows/${params.id}`),
    enabled: Boolean(params.id),
  });

  if (flow.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (flow.isError || !flow.data) {
    return <p className="text-sm text-red-600">No se pudo cargar el flujo.</p>;
  }

  return <FlowEditor flow={flow.data} />;
}
