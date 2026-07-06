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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ERROR_CODES, type TagDto } from '@wolfiax/shared';
import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toTagDto } from './inbox.mappers';

class TagBodyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

class TagPatchDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

@ApiTags('inbox')
@ApiBearerAuth()
@Controller('tags')
export class TagsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Etiquetas de la organización' })
  async list(@CurrentUser() user: AuthUser): Promise<TagDto[]> {
    const tags = await this.prisma.withTenant(user.organizationId, (tx) =>
      tx.tag.findMany({
        where: { organizationId: user.organizationId },
        orderBy: { name: 'asc' },
      }),
    );
    return tags.map(toTagDto);
  }

  @Post()
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Crea una etiqueta' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: TagBodyDto): Promise<TagDto> {
    const name = dto.name.trim();
    const tag = await this.prisma.withTenant(user.organizationId, async (tx) => {
      const existing = await tx.tag.findFirst({
        where: { organizationId: user.organizationId, name: { equals: name, mode: 'insensitive' } },
      });
      if (existing) {
        throw new AppError(
          HttpStatus.CONFLICT,
          ERROR_CODES.VALIDATION_ERROR,
          'Ya existe una etiqueta con ese nombre.',
        );
      }
      return tx.tag.create({
        data: {
          organizationId: user.organizationId,
          name,
          ...(dto.color ? { color: dto.color } : {}),
        },
      });
    });
    return toTagDto(tag);
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agent')
  @ApiOperation({ summary: 'Renombra o recolorea una etiqueta' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TagPatchDto,
  ): Promise<TagDto> {
    const tag = await this.prisma.withTenant(user.organizationId, async (tx) => {
      const existing = await tx.tag.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!existing) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Etiqueta no encontrada.');
      }
      return tx.tag.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name.trim() } : {}),
          ...(dto.color ? { color: dto.color } : {}),
        },
      });
    });
    return toTagDto(tag);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina una etiqueta (se quita de todas las conversaciones)' })
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.prisma.withTenant(user.organizationId, async (tx) => {
      const existing = await tx.tag.findFirst({
        where: { id, organizationId: user.organizationId },
      });
      if (!existing) {
        throw new AppError(HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND, 'Etiqueta no encontrada.');
      }
      await tx.tag.delete({ where: { id } });
    });
  }
}
