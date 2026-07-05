import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthResponseDto, InvitationPublicDto, MeDto } from '@wolfiax/shared';
import type { Request, Response } from 'express';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH, type AuthUser } from '../../common/auth/auth.types';
import { CurrentUser, Public } from '../../common/auth/decorators';
import type { Env } from '../../config/configuration';
import { AuthService, type RequestContext, type SessionResult } from './auth.service';
import { AcceptInvitationDto, LoginDto, RegisterDto, SwitchOrgDto } from './dto';
import { toOrganizationDto, toUserDto } from './mappers';
import { TokensService } from './tokens.service';

/** 10 intentos/min en endpoints sensibles de credenciales. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;
  private readonly cookieDomain?: string;

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieSecure = config.get('COOKIE_SECURE', { infer: true });
    this.cookieDomain = config.get('COOKIE_DOMAIN', { infer: true });
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  @ApiOperation({ summary: 'Crea cuenta + organización (rol owner)' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.auth.register(dto, this.ctx(req));
    return this.respond(res, session);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login con email y contraseña' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.auth.login(dto, this.ctx(req));
    return this.respond(res, session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rota el refresh token (cookie) y emite un access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.auth.refresh(this.refreshCookie(req), this.ctx(req));
    return this.respond(res, session);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoca la sesión y limpia la cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.refreshCookie(req), this.ctx(req));
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Perfil + organizaciones del usuario autenticado' })
  me(@CurrentUser() user: AuthUser): Promise<MeDto> {
    return this.auth.me(user.userId, user.organizationId, user.role);
  }

  @Post('switch-org')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambia la organización activa (rota tokens)' })
  async switchOrg(
    @CurrentUser() user: AuthUser,
    @Body() dto: SwitchOrgDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.auth.switchOrg(
      user.userId,
      dto.organization_id,
      this.refreshCookie(req),
      this.ctx(req),
    );
    return this.respond(res, session);
  }

  @Public()
  @Get('invitations/:token')
  @ApiOperation({ summary: 'Datos públicos de una invitación (pantalla de aceptar)' })
  getInvitation(@Param('token') token: string): Promise<InvitationPublicDto> {
    return this.auth.getInvitationPublic(token);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('invitations/:token/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acepta una invitación (crea cuenta si no existe)' })
  async acceptInvitation(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    // Si viene un access token válido lo usamos para el camino "cuenta existente";
    // si no viene o es inválido, se sigue el camino público.
    let authUserId: string | undefined;
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      try {
        const payload = await this.tokens.verifyAccessToken(header.slice('Bearer '.length));
        authUserId = payload.sub;
      } catch {
        authUserId = undefined;
      }
    }
    const session = await this.auth.acceptInvitation(token, dto, authUserId, this.ctx(req));
    return this.respond(res, session);
  }

  // ---------------------------------------------------------------------------

  private ctx(req: Request): RequestContext {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  private refreshCookie(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE];
  }

  private respond(res: Response, session: SessionResult): AuthResponseDto {
    res.cookie(REFRESH_COOKIE, session.refreshTokenRaw, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: session.refreshMaxAgeMs,
      ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
    });
    return {
      access_token: session.accessToken,
      user: toUserDto(session.user),
      organization: toOrganizationDto(session.organization),
      role: session.role,
    };
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      ...(this.cookieDomain ? { domain: this.cookieDomain } : {}),
    });
  }
}
