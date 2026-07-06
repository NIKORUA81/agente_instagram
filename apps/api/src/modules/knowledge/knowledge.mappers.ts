import type { CatalogItem, KnowledgeSource } from '@prisma/client';
import type {
  CatalogItemDto,
  KnowledgeSourceDto,
  KnowledgeSourceType,
  KnowledgeStatus,
} from '@wolfiax/shared';

export function toKnowledgeSourceDto(s: KnowledgeSource): KnowledgeSourceDto {
  return {
    id: s.id,
    type: s.type as KnowledgeSourceType,
    name: s.name,
    url: s.url,
    status: s.status as KnowledgeStatus,
    error: s.error,
    chunk_count: s.chunkCount,
    refreshed_at: s.refreshedAt?.toISOString() ?? null,
    created_at: s.createdAt.toISOString(),
  };
}

export function toCatalogItemDto(i: CatalogItem): CatalogItemDto {
  return {
    id: i.id,
    sku: i.sku,
    name: i.name,
    description: i.description,
    price: i.price !== null ? Number(i.price) : null,
    currency: i.currency,
    stock: i.stock,
    active: i.active,
    created_at: i.createdAt.toISOString(),
  };
}
