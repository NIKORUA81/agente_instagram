import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES, type ContactDto, type PaginatedDto } from '@wolfiax/shared';
import { HttpStatus } from '@nestjs/common';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { decodeCursor, encodeCursor, toContactDto } from './inbox.mappers';

const PAGE_SIZE = 50;

@ApiTags('inbox')
@ApiBearerAuth()
@Controller('contacts')
export class ContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Contactos (clientes que han escrito por DM)' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('cursor') cursorRaw?: string,
  ): Promise<PaginatedDto<ContactDto & { conversation_id: string | null }>> {
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null;
    const search = q?.trim();

    const rows = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.contact.findMany({
        where: {
          organizationId: user.organizationId,
          ...(search
            ? {
                OR: [
                  { username: { contains: search, mode: 'insensitive' } },
                  { name: { contains: search, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(cursor
            ? {
                OR: [
                  { lastSeenAt: { lt: cursor.date } },
                  { lastSeenAt: cursor.date, id: { lt: cursor.id } },
                ],
              }
            : {}),
        },
        include: { conversations: { select: { id: true }, take: 1 } },
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
      }),
    );

    const page = rows.slice(0, PAGE_SIZE);
    const hasMore = rows.length > PAGE_SIZE;
    const lastRow = page[page.length - 1];
    return {
      items: page.map((c) => ({
        ...toContactDto(c),
        conversation_id: c.conversations[0]?.id ?? null,
      })),
      next_cursor: hasMore && lastRow ? encodeCursor(lastRow.lastSeenAt, lastRow.id) : null,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Perfil de un contacto' })
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactDto> {
    const contact = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.contact.findFirst({ where: { id, organizationId: user.organizationId } }),
    );
    if (!contact) {
      throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Contacto no encontrado.');
    }
    return toContactDto(contact);
  }
}
