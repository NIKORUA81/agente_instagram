import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  extractRefreshCookie,
  registerTenant,
  uniqueEmail,
} from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registro → me → refresh → logout (ciclo completo)', async () => {
    const email = uniqueEmail('ciclo');
    const password = 'una-contraseña-larga-1';

    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        full_name: 'Ana García',
        organization_name: 'Café París',
      })
      .expect(201);

    expect(reg.body.access_token).toBeDefined();
    expect(reg.body.role).toBe('owner');
    expect(reg.body.organization.slug).toMatch(/^cafe-paris-/);

    // me
    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${reg.body.access_token}`)
      .expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.current_role).toBe('owner');
    expect(me.body.organizations).toHaveLength(1);

    // refresh rota la cookie y entrega nuevo access token
    const cookie1 = extractRefreshCookie(reg.headers['set-cookie']);
    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1)
      .expect(200);
    expect(refreshed.body.access_token).toBeDefined();
    const cookie2 = extractRefreshCookie(refreshed.headers['set-cookie']);
    expect(cookie2).not.toEqual(cookie1);

    // logout revoca la familia
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie2)
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2)
      .expect(401);
  });

  it('login con contraseña incorrecta devuelve 401 con código estable', async () => {
    const email = uniqueEmail('badpass');
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email,
        password: 'contraseña-correcta-1',
        full_name: 'Test',
        organization_name: 'Org',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'contraseña-incorrecta' })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('registro con email duplicado devuelve 409 EMAIL_IN_USE', async () => {
    const email = uniqueEmail('dupe');
    const payload = {
      email,
      password: 'password-larguisima-1',
      full_name: 'Test',
      organization_name: 'Org',
    };
    await request(app.getHttpServer()).post('/api/v1/auth/register').send(payload).expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(payload)
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_IN_USE');
  });

  it('detección de reuso: un refresh token ya rotado revoca toda la familia', async () => {
    const session = await registerTenant(app, 'Org Reuso');
    const oldCookie = session.refreshCookie;

    // Rotación normal
    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(200);
    const newCookie = extractRefreshCookie(refreshed.headers['set-cookie']);

    // Reuso del token viejo ⇒ 401 y familia revocada
    const reuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(401);
    expect(reuse.body.error.code).toBe('SESSION_REVOKED');

    // El token "bueno" también quedó revocado
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', newCookie)
      .expect(401);
  });

  it('endpoints protegidos exigen access token', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('la validación rechaza contraseñas cortas', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: uniqueEmail('short'),
        password: 'corta',
        full_name: 'Test',
        organization_name: 'Org',
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('flujo de invitación: crear → consultar → aceptar con cuenta nueva', async () => {
    const owner = await registerTenant(app, 'Org Invita');
    const invitedEmail = uniqueEmail('invitado');

    const created = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${owner.orgId}/invitations`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: invitedEmail, role: 'agent' })
      .expect(201);
    expect(created.body.accept_url).toContain('/invite/');
    const rawToken = created.body.accept_url.split('/invite/')[1];

    const info = await request(app.getHttpServer())
      .get(`/api/v1/auth/invitations/${rawToken}`)
      .expect(200);
    expect(info.body.email).toBe(invitedEmail);
    expect(info.body.account_exists).toBe(false);

    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/auth/invitations/${rawToken}/accept`)
      .send({ full_name: 'Invitado Nuevo', password: 'password-larguisima-2' })
      .expect(200);
    expect(accepted.body.role).toBe('agent');
    expect(accepted.body.organization.id).toBe(owner.orgId);

    // La invitación ya no puede reutilizarse
    await request(app.getHttpServer())
      .post(`/api/v1/auth/invitations/${rawToken}/accept`)
      .send({ full_name: 'Otro', password: 'password-larguisima-3' })
      .expect(400);

    // El invitado aparece como miembro
    const members = await request(app.getHttpServer())
      .get(`/api/v1/orgs/${owner.orgId}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const emails = members.body.map((m: { email: string }) => m.email);
    expect(emails).toContain(invitedEmail);
  });
});
