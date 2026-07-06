import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ERROR_CODES, type KnowledgeSourceDto } from '@wolfiax/shared';
import type { Queue } from 'bullmq';
import type { AuthUser } from '../../common/auth/auth.types';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_INGEST } from '../../common/queue/queue.module';
import type { IngestJobData } from './ingest.types';
import { toKnowledgeSourceDto } from './knowledge.mappers';

const MAX_CONTENT_BYTES = 25 * 1024 * 1024; // 25 MB

export interface CreateSourceInput {
  type: string; // text | faq | policy | url | pdf | docx | xlsx
  name: string;
  text?: string;
  url?: string;
  content_base64?: string;
}

/** Nombre estable de la fuente sintética que indexa el catálogo para el RAG. */
const CATALOG_SOURCE_NAME = 'Catálogo de productos';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(QUEUE_INGEST) private readonly ingestQueue: Queue,
  ) {}

  async list(actor: AuthUser): Promise<KnowledgeSourceDto[]> {
    const sources = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.knowledgeSource.findMany({
        where: { organizationId: actor.organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return sources.map(toKnowledgeSourceDto);
  }

  async create(actor: AuthUser, input: CreateSourceInput): Promise<KnowledgeSourceDto> {
    this.validate(input);
    const source = await this.prisma.withTenant(actor.organizationId, (tx) =>
      tx.knowledgeSource.create({
        data: {
          organizationId: actor.organizationId,
          type: input.type,
          name: input.name.trim(),
          url: input.url ?? null,
          status: 'processing',
        },
      }),
    );

    await this.enqueue({
      organizationId: actor.organizationId,
      sourceId: source.id,
      sourceType: input.type,
      name: source.name,
      text: input.text,
      contentBase64: input.content_base64,
      url: input.url,
    });

    return toKnowledgeSourceDto(source);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const source = await tx.knowledgeSource.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!source) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Fuente no encontrada.');
      }
      await tx.knowledgeSource.delete({ where: { id } }); // cascada borra los chunks
    });
  }

  /** Re-procesa una fuente de tipo URL (re-crawl). Otros tipos: recrear. */
  async refresh(actor: AuthUser, id: string): Promise<KnowledgeSourceDto> {
    const source = await this.prisma.withTenant(actor.organizationId, async (tx) => {
      const s = await tx.knowledgeSource.findFirst({
        where: { id, organizationId: actor.organizationId },
      });
      if (!s) throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Fuente no encontrada.');
      if (s.type !== 'url' || !s.url) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          'Solo las fuentes de tipo URL se pueden re-procesar. Para las demás, recréalas.',
        );
      }
      return tx.knowledgeSource.update({ where: { id }, data: { status: 'processing', error: null } });
    });

    await this.enqueue({
      organizationId: actor.organizationId,
      sourceId: source.id,
      sourceType: 'url',
      name: source.name,
      url: source.url!,
    });
    return toKnowledgeSourceDto(source);
  }

  /**
   * Reconstruye la fuente sintética del catálogo (productos activos) para que la
   * IA pueda responder sobre productos y precios. Se llama al mutar el catálogo.
   */
  async reindexCatalog(organizationId: string): Promise<void> {
    const { text, sourceId } = await this.prisma.withTenant(organizationId, async (tx) => {
      const items = await tx.catalogItem.findMany({
        where: { organizationId, active: true },
        orderBy: { name: 'asc' },
      });
      const lines = items.map((i) => {
        const price = i.price !== null ? `${i.price} ${i.currency}` : 'consultar';
        const stock = i.stock !== null ? `, stock: ${i.stock}` : '';
        const sku = i.sku ? ` (SKU ${i.sku})` : '';
        return `- ${i.name}${sku}: ${i.description ?? ''} — precio: ${price}${stock}`;
      });
      const body = lines.length
        ? `Catálogo de productos y servicios del negocio:\n${lines.join('\n')}`
        : '';

      const existing = await tx.knowledgeSource.findFirst({
        where: { organizationId, name: CATALOG_SOURCE_NAME },
      });

      if (!body) {
        // Sin productos activos: elimina la fuente sintética si existía
        if (existing) await tx.knowledgeSource.delete({ where: { id: existing.id } });
        return { text: '', sourceId: null };
      }

      const source =
        existing ??
        (await tx.knowledgeSource.create({
          data: { organizationId, type: 'text', name: CATALOG_SOURCE_NAME, status: 'processing' },
        }));
      if (existing) {
        await tx.knowledgeSource.update({ where: { id: source.id }, data: { status: 'processing' } });
      }
      return { text: body, sourceId: source.id };
    });

    if (!sourceId) return;
    await this.enqueue({
      organizationId,
      sourceId,
      sourceType: 'text',
      name: CATALOG_SOURCE_NAME,
      text,
    });
  }

  // ---------------------------------------------------------------------------

  private validate(input: CreateSourceInput): void {
    if (input.type === 'url') {
      if (!input.url) {
        throw new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Falta la URL.');
      }
      return;
    }
    if (['text', 'faq', 'policy'].includes(input.type)) {
      if (!input.text?.trim()) {
        throw new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Falta el texto.');
      }
      return;
    }
    if (['pdf', 'docx', 'xlsx'].includes(input.type)) {
      if (!input.content_base64) {
        throw new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Falta el archivo.');
      }
      const bytes = Math.floor((input.content_base64.length * 3) / 4);
      if (bytes > MAX_CONTENT_BYTES) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          'El archivo supera el máximo de 25 MB.',
        );
      }
      return;
    }
    throw new AppError(HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR, 'Tipo de fuente inválido.');
  }

  private async enqueue(data: IngestJobData): Promise<void> {
    await this.ingestQueue.add('ingest', data as unknown as Prisma.JsonObject, { jobId: data.sourceId });
  }
}
