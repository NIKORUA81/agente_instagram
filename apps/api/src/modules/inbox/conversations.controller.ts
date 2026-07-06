import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONVERSATION_STATUSES,
  ERROR_CODES,
  WS_EVENTS,
  type ConversationDto,
  type ConversationStatus,
  type MessageDto,
  type NoteDto,
  type PaginatedDto,
} from '@wolfiax/shared';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { MessagingService } from '../messaging/messaging.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  decodeCursor,
  encodeCursor,
  toConversationDto,
  toMessageDto,
} from './inbox.mappers';

const PAGE_SIZE = 30;

const CONVERSATION_INCLUDE = {
  contact: true,
  tags: { include: { tag: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};

class UpdateConversationDto {
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES as readonly string[])
  status?: ConversationStatus;

  /** null = quitar asignación */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigned_user_id?: string | null;
}

class SendMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio'])
  attachment_type?: 'image' | 'video' | 'audio';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  attachment_url?: string;
}

class AddTagDto {
  @IsUUID()
  tag_id!: string;
}

class CreateNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

class ListConversationsQuery {
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES as readonly string[])
  status?: ConversationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  tag?: string;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('inbox')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly audit: AuditService,
    private readonly gateway: RealtimeGateway,
  ) {}

  @Post(':id/handover')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Transfiere la conversación a un humano (silencia la IA)' })
  async handover(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDto> {
    await this.findOrFail(user, id);
    const updated = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.update({
        where: { id },
        data: { mode: 'human', status: 'pending' },
        include: CONVERSATION_INCLUDE,
      }),
    );
    const dto = toConversationDto(updated);
    this.gateway.emitToOrg(user.organizationId, WS_EVENTS.CONVERSATION_UPDATED, dto);
    return dto;
  }

  @Post(':id/return-to-ai')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Devuelve la conversación al modo IA' })
  async returnToAi(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDto> {
    await this.findOrFail(user, id);
    const updated = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.update({
        where: { id },
        data: { mode: 'ai', status: 'open' },
        include: CONVERSATION_INCLUDE,
      }),
    );
    const dto = toConversationDto(updated);
    this.gateway.emitToOrg(user.organizationId, WS_EVENTS.CONVERSATION_UPDATED, dto);
    return dto;
  }

  @Get()
  @ApiOperation({ summary: 'Bandeja: filtros por estado/etiqueta + búsqueda' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListConversationsQuery,
  ): Promise<PaginatedDto<ConversationDto>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const q = query.q?.trim();

    const rows = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.findMany({
        where: {
          organizationId: user.organizationId,
          ...(query.status ? { status: query.status } : { status: { not: 'archived' } }),
          ...(query.tag ? { tags: { some: { tagId: query.tag } } } : {}),
          ...(q
            ? {
                OR: [
                  { contact: { username: { contains: q, mode: 'insensitive' } } },
                  { contact: { name: { contains: q, mode: 'insensitive' } } },
                  { messages: { some: { text: { contains: q, mode: 'insensitive' } } } },
                ],
              }
            : {}),
          ...(cursor
            ? {
                OR: [
                  { lastMessageAt: { lt: cursor.date } },
                  { lastMessageAt: cursor.date, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: CONVERSATION_INCLUDE,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
      }),
    );

    const page = rows.slice(0, PAGE_SIZE);
    const hasMore = rows.length > PAGE_SIZE;
    const lastRow = page[page.length - 1];
    return {
      items: page.map(toConversationDto),
      next_cursor:
        hasMore && lastRow?.lastMessageAt ? encodeCursor(lastRow.lastMessageAt, lastRow.id) : null,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una conversación' })
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConversationDto> {
    return toConversationDto(await this.findOrFail(user, id));
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Historial de mensajes (descendente, keyset)' })
  async messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('cursor') cursorRaw?: string,
  ): Promise<PaginatedDto<MessageDto>> {
    await this.findOrFail(user, id);
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;

    const rows = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.message.findMany({
        where: {
          conversationId: id,
          ...(cursor
            ? {
                OR: [
                  { createdAt: { lt: cursor.date } },
                  { createdAt: cursor.date, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
      }),
    );

    const page = rows.slice(0, PAGE_SIZE);
    const hasMore = rows.length > PAGE_SIZE;
    const lastRow = page[page.length - 1];
    return {
      items: page.map(toMessageDto),
      next_cursor: hasMore && lastRow ? encodeCursor(lastRow.createdAt, lastRow.id) : null,
    };
  }

  @Post(':id/messages')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Envía un mensaje como agente (dentro de la ventana de 24h)' })
  async send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageDto> {
    const message = await this.messaging.sendAsAgent(user, id, dto);
    return toMessageDto(message);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Cambia estado o asignación' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationDto> {
    await this.findOrFail(user, id);

    if (dto.assigned_user_id) {
      const member = await this.prisma.withTenant(user.organizationId, (tx) =>
        tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: user.organizationId,
              userId: dto.assigned_user_id!,
            },
          },
        }),
      );
      if (!member) {
        throw new AppError(
          HttpStatus.BAD_REQUEST,
          ERROR_CODES.VALIDATION_ERROR,
          'El usuario asignado no es miembro de la organización.',
        );
      }
    }

    const updated = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.assigned_user_id !== undefined ? { assignedUserId: dto.assigned_user_id } : {}),
        },
        include: CONVERSATION_INCLUDE,
      }),
    );
    return toConversationDto(updated);
  }

  // --- Etiquetas -------------------------------------------------------------

  @Post(':id/tags')
  @Roles('owner', 'admin', 'agent')
  @HttpCode(204)
  @ApiOperation({ summary: 'Añade una etiqueta a la conversación' })
  async addTag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTagDto,
  ): Promise<void> {
    await this.findOrFail(user, id);
    await this.prisma.withTenant(user.organizationId, async (tx) => {
      const tag = await tx.tag.findFirst({
        where: { id: dto.tag_id, organizationId: user.organizationId },
      });
      if (!tag) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Etiqueta no encontrada.');
      }
      await tx.conversationTag.upsert({
        where: { conversationId_tagId: { conversationId: id, tagId: tag.id } },
        create: { conversationId: id, tagId: tag.id, organizationId: user.organizationId },
        update: {},
      });
    });
  }

  @Delete(':id/tags/:tagId')
  @Roles('owner', 'admin', 'agent')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quita una etiqueta' })
  async removeTag(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
  ): Promise<void> {
    await this.findOrFail(user, id);
    await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversationTag.deleteMany({ where: { conversationId: id, tagId } }),
    );
  }

  // --- Notas internas ---------------------------------------------------------

  @Get(':id/notes')
  @ApiOperation({ summary: 'Notas internas (nunca visibles para el cliente)' })
  async listNotes(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NoteDto[]> {
    await this.findOrFail(user, id);
    const notes = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.note.findMany({
        where: { conversationId: id },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return notes.map((n) => ({
      id: n.id,
      conversation_id: n.conversationId,
      body: n.body,
      user_id: n.userId,
      user_name: n.user.fullName,
      created_at: n.createdAt.toISOString(),
    }));
  }

  @Post(':id/notes')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Añade una nota interna' })
  async addNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
    @Req() req: Request,
  ): Promise<NoteDto> {
    await this.findOrFail(user, id);
    const note = await this.prisma.withTenant(user.organizationId, async (tx) => {
      const created = await tx.note.create({
        data: {
          organizationId: user.organizationId,
          conversationId: id,
          userId: user.userId,
          body: dto.body.trim(),
        },
        include: { user: true },
      });
      await this.audit.log(tx, {
        organizationId: user.organizationId,
        userId: user.userId,
        action: 'note.created',
        resource: 'conversation',
        resourceId: id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return created;
    });
    return {
      id: note.id,
      conversation_id: note.conversationId,
      body: note.body,
      user_id: note.userId,
      user_name: note.user.fullName,
      created_at: note.createdAt.toISOString(),
    };
  }

  @Delete(':id/notes/:noteId')
  @Roles('owner', 'admin', 'agent')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina una nota propia (admin/owner: cualquiera)' })
  async removeNote(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<void> {
    await this.findOrFail(user, id);
    await this.prisma.withTenant(user.organizationId, async (tx) => {
      const note = await tx.note.findFirst({ where: { id: noteId, conversationId: id } });
      if (!note) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Nota no encontrada.');
      }
      const canDelete =
        note.userId === user.userId || user.role === 'owner' || user.role === 'admin';
      if (!canDelete) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          ERROR_CODES.FORBIDDEN,
          'Solo puedes borrar tus propias notas.',
        );
      }
      await tx.note.delete({ where: { id: noteId } });
    });
  }

  // ---------------------------------------------------------------------------

  private async findOrFail(user: AuthUser, id: string) {
    const conversation = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.findFirst({
        where: { id, organizationId: user.organizationId },
        include: CONVERSATION_INCLUDE,
      }),
    );
    if (!conversation) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        ERROR_CODES.NOT_FOUND,
        'Conversación no encontrada.',
      );
    }
    return conversation;
  }
}
