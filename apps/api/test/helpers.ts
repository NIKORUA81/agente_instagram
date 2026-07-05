import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}@test.wolfiax.dev`;
}

export interface TestSession {
  accessToken: string;
  refreshCookie: string;
  userId: string;
  orgId: string;
}

/** Registra usuario + organización nuevos y devuelve credenciales listas. */
export async function registerTenant(
  app: INestApplication,
  orgName: string,
): Promise<TestSession> {
  const email = uniqueEmail('user');
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({
      email,
      password: 'password-larguisima-1',
      full_name: 'Usuario Test',
      organization_name: orgName,
    })
    .expect(201);

  return {
    accessToken: res.body.access_token,
    refreshCookie: extractRefreshCookie(res.headers['set-cookie']),
    userId: res.body.user.id,
    orgId: res.body.organization.id,
  };
}

export function extractRefreshCookie(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const rt = cookies.find((c) => c.startsWith('wsai_rt='));
  if (!rt) throw new Error('No se recibió cookie wsai_rt');
  return rt.split(';')[0];
}
