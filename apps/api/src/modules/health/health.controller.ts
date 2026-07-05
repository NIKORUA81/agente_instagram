import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness + readiness básico (usado por Docker HEALTHCHECK y el proxy). */
  @Public()
  @Get('healthz')
  async health(): Promise<{ status: string; db: string; uptime_seconds: number }> {
    let db = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }
    return { status: db === 'ok' ? 'ok' : 'degraded', db, uptime_seconds: Math.floor(process.uptime()) };
  }
}
