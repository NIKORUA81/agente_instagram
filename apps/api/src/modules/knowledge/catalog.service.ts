import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES, type CatalogItemDto } from '@wolfiax/shared';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KnowledgeService } from './knowledge.service';
import { toCatalogItemDto } from './knowledge.mappers';

export interface CatalogItemInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string;
  stock?: number | null;
  active?: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async list(actor: AuthUser): Promise<CatalogItemDto[]> {
    const items = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.catalogItem.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return items.map(toCatalogItemDto);
  }

  async create(actor: AuthUser, input: CatalogItemInput): Promise<CatalogItemDto> {
    const item = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.catalogItem.create({
        data: {
          organizationId: actor.organizationId,
          name: input.name.trim(),
          sku: input.sku ?? null,
          description: input.description ?? null,
          price: input.price ?? null,
          currency: input.currency ?? 'USD',
          stock: input.stock ?? null,
          active: input.active ?? true,
        },
      }),
    );
    await this.knowledge.reindexCatalog(actor.organizationId);
    return toCatalogItemDto(item);
  }

  async update(actor: AuthUser, id: string, input: Partial<CatalogItemInput>): Promise<CatalogItemDto> {
    const item = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const existing = await tx.catalogItem.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!existing) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Producto no encontrado.');
      }
      return tx.catalogItem.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.price !== undefined ? { price: input.price as unknown as Prisma.Decimal } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.stock !== undefined ? { stock: input.stock } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        },
      });
    });
    await this.knowledge.reindexCatalog(actor.organizationId);
    return toCatalogItemDto(item);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const existing = await tx.catalogItem.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!existing) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Producto no encontrado.');
      }
      await tx.catalogItem.delete({ where: { id } });
    });
    await this.knowledge.reindexCatalog(actor.organizationId);
  }
}
