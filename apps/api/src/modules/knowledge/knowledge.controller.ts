import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  KNOWLEDGE_SOURCE_TYPES,
  type CatalogItemDto,
  type KnowledgeSourceDto,
  type KnowledgeSourceType,
} from '@wolfiax/shared';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Roles } from '../../common/auth/decorators';
import { CatalogService } from './catalog.service';
import { KnowledgeService } from './knowledge.service';

class CreateSourceDto {
  @IsIn(KNOWLEDGE_SOURCE_TYPES as readonly string[]) type!: KnowledgeSourceType;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(200_000) text?: string;
  @IsOptional() @IsUrl() url?: string;
  @IsOptional() @IsString() content_base64?: string;
}

class CatalogItemDtoIn {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(80) sku?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) description?: string | null;
  @IsOptional() @IsNumber() @Min(0) price?: number | null;
  @IsOptional() @IsString() @MaxLength(8) currency?: string;
  @IsOptional() @IsInt() @Min(0) stock?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('knowledge')
@ApiBearerAuth()
@Controller()
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly catalog: CatalogService,
  ) {}

  // --- Fuentes ---------------------------------------------------------------

  @Get('knowledge/sources')
  @ApiOperation({ summary: 'Fuentes de conocimiento del tenant' })
  listSources(@CurrentUser() user: AuthUser): Promise<KnowledgeSourceDto[]> {
    return this.knowledge.list(user);
  }

  @Post('knowledge/sources')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Crea una fuente (texto, URL o archivo) y la ingiere' })
  createSource(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSourceDto,
  ): Promise<KnowledgeSourceDto> {
    return this.knowledge.create(user, dto);
  }

  @Post('knowledge/sources/:id/refresh')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Re-procesa una fuente de tipo URL' })
  refreshSource(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeSourceDto> {
    return this.knowledge.refresh(user, id);
  }

  @Delete('knowledge/sources/:id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina una fuente y sus fragmentos' })
  removeSource(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.knowledge.remove(user, id);
  }

  // --- Catálogo --------------------------------------------------------------

  @Get('catalog/items')
  @ApiOperation({ summary: 'Productos/servicios del catálogo' })
  listCatalog(@CurrentUser() user: AuthUser): Promise<CatalogItemDto[]> {
    return this.catalog.list(user);
  }

  @Post('catalog/items')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Añade un producto y reindexa el catálogo para la IA' })
  createCatalog(
    @CurrentUser() user: AuthUser,
    @Body() dto: CatalogItemDtoIn,
  ): Promise<CatalogItemDto> {
    return this.catalog.create(user, dto);
  }

  @Patch('catalog/items/:id')
  @Roles('owner', 'admin')
  @ApiOperation({ summary: 'Actualiza un producto' })
  updateCatalog(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CatalogItemDtoIn,
  ): Promise<CatalogItemDto> {
    return this.catalog.update(user, id, dto);
  }

  @Delete('catalog/items/:id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiOperation({ summary: 'Elimina un producto' })
  removeCatalog(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.catalog.remove(user, id);
  }
}
