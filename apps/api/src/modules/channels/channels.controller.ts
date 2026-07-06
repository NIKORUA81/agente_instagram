import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CONNECTION_TYPES,
  type ChannelDto,
  type ConnectSessionDto,
  type ConnectStartResponseDto,
  type ConnectionType,
} from '@wolfiax/shared';
import { IsIn, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import type { AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators';
import type { Env } from '../../config/configuration';
import type { RequestContext } from '../iam/auth.service';
import { ChannelsService, toChannelDto } from './channels.service';
import { MetaOAuthService } from './meta-oauth.service';

class ConnectDto {
  @IsIn(CONNECTION_TYPES as readonly string[])
  connection_type!: ConnectionType;
}

class SelectAccountDto {
  @IsString()
  @MinLength(1)
  ig_user_id!: string;
}

@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  private readonly webOrigin: string;

  constructor(
    private readonly channels: ChannelsService,
    private readonly oauth: MetaOAuthService,
    config: ConfigService<Env, true>,
  ) {
    this.webOrigin = config.get('WEB_ORIGIN', { infer: true });
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Canales de la organización' })
  list(@CurrentUser() user: AuthUser): Promise<ChannelDto[]> {
    return this.channels.list(user);
  }

  @Post('instagram/connect')
  @Roles('owner', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Inicia el OAuth con Meta y devuelve la URL de autorización' })
  async connect(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConnectDto,
  ): Promise<ConnectStartResponseDto> {
    const url = await this.oauth.buildAuthorizationUrl(
      user.organizationId,
      user.userId,
      dto.connection_type,
    );
    return { authorization_url: url };
  }

  /**
   * Callback de Meta (navegador del usuario). Público: la autenticidad viene
   * del state firmado. Siempre termina en un redirect al dashboard.
   */
  @Public()
  @Get('instagram/callback')
  @ApiOperation({ summary: 'Callback OAuth de Meta (redirige al dashboard)' })
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') oauthError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const settingsUrl = `${this.webOrigin}/settings/channels`;
    if (oauthError || !code || !state) {
      res.redirect(`${settingsUrl}?connect_error=denied`);
      return;
    }
    try {
      const outcome = await this.oauth.handleCallback(code, state);
      if (outcome.kind === 'single') {
        await this.channels.createFromSingleSession(outcome.session, this.ctx(req));
        res.redirect(`${settingsUrl}?connected=1`);
      } else {
        res.redirect(`${settingsUrl}?connect_session=${outcome.sessionId}`);
      }
    } catch {
      res.redirect(`${settingsUrl}?connect_error=failed`);
    }
  }

  @Get('connect-sessions/:id')
  @Roles('owner', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Candidatas de una conexión pendiente de selección' })
  getConnectSession(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ConnectSessionDto> {
    return this.channels.getSessionDto(user, id);
  }

  @Post('connect-sessions/:id/select')
  @Roles('owner', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Elige la cuenta IG y crea el canal' })
  selectAccount(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectAccountDto,
    @Req() req: Request,
  ): Promise<ChannelDto> {
    return this.channels.selectAccount(user, id, dto.ig_user_id, this.ctx(req));
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Detalle de un canal' })
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChannelDto> {
    return toChannelDto(await this.channels.getOrFail(user, id));
  }

  @Post(':id/health-check')
  @Roles('owner', 'admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verifica el token y actualiza el estado del canal' })
  healthCheck(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChannelDto> {
    return this.channels.healthCheck(user, id);
  }

  @Delete(':id')
  @Roles('owner', 'admin')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desconecta el canal (conserva el historial)' })
  disconnect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    return this.channels.disconnect(user, id, this.ctx(req));
  }

  private ctx(req: Request): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
}
