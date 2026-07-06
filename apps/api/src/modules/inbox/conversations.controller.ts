import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONVERSATION_STATUSES,
  ERROR_CODES,
  type ConversationDto,
  type ConversationStatus,
  type MessageDto,
  type PaginatedDto,
} from '@wolfiax/shared';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  decodeCursor,
  encodeCursor,
  toConversationDto,
  toMessageDto,
} from './inbox.mappers';

const PAGE_SIZE = 30;

class UpdateConversationDto {
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES as readonly string[])
  status?: ConversationStatus;
}

class ListConversationsQuery {
  @IsOptional()
  @IsIn(CONVERSATION_STATUSES as readonly string[])
  status?: ConversationStatus;

  @IsOptional()
  @IsString()
  cursor?: string;
}

@ApiTags('inbox')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Bandeja de conversaciones (keyset por actividad)' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListConversationsQuery,
  ): Promise<PaginatedDto<ConversationDto>> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;

    const rows = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.findMany({
        where: {
          organizationId: user.organizationId,
          ...(query.status ? { status: query.status } : { status: { not: 'archived' } }),
          ...(cursor
            ? {
                OR: [
                  { lastMessageAt: { lt: cursor.date } },
                  { lastMessageAt: cursor.date, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: {
          contact: true,
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
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
    const conversation = await this.findOrFail(user, id);
    return toConversationDto(conversation);
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

  @Patch(':id')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Cambia el estado de la conversación' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationDto> {
    await this.findOrFail(user, id);
    const updated = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.update({
        where: { id },
        data: { ...(dto.status ? { status: dto.status } : {}) },
        include: { contact: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
    );
    return toConversationDto(updated);
  }

  // ---------------------------------------------------------------------------

  private async findOrFail(user: AuthUser, id: string) {
    const conversation = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.conversation.findFirst({
        where: { id, organizationId: user.organizationId },
        include: { contact: true, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
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
