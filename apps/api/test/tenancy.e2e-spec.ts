import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, registerTenant, type TestSession } from './helpers';

/**
 * Suite de aislamiento multi-tenant (criterio de aceptación de F0):
 * un usuario de la organización A NUNCA puede leer ni mutar recursos de la
 * organización B, aunque conozca sus UUIDs.
 */
describe('Aislamiento multi-tenant (e2e)', () => {
  let app: INestApplication;
  let tenantA: TestSession;
  let tenantB: TestSession;

  beforeAll(async () => {
    app = await createTestApp();
    tenantA = await registerTenant(app, 'Empresa A');
    tenantB = await registerTenant(app, 'Empresa B');
  });

  afterAll(async () => {
    await app.close();
  });

  it('A no puede leer la organización de B', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orgs/${tenantB.orgId}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(403);
    expect(res.body.error.code).toBe('ORG_MISMATCH');
  });

  it('A no puede modificar la organización de B', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${tenantB.orgId}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ name: 'Hackeada' })
      .expect(403);
  });

  it('A no puede listar miembros de B', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/orgs/${tenantB.orgId}/members`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(403);
  });

  it('A no puede cambiar roles en B', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${tenantB.orgId}/members/${tenantB.userId}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ role: 'analyst' })
      .expect(403);
  });

  it('A no puede eliminar miembros de B', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${tenantB.orgId}/members/${tenantB.userId}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(403);
  });

  it('A no puede crear invitaciones en B', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/orgs/${tenantB.orgId}/invitations`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ email: 'intruso@evil.com', role: 'admin' })
      .expect(403);
  });

  it('A no puede listar invitaciones de B', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/orgs/${tenantB.orgId}/invitations`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(403);
  });

  it('A no puede cambiar a la organización de B sin membresía', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/switch-org')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .set('Cookie', tenantA.refreshCookie)
      .send({ organization_id: tenantB.orgId })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('los roles se aplican: un agent no puede invitar', async () => {
    // Owner de A invita a un agent
    const created = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${tenantA.orgId}/invitations`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ email: `agente-${Date.now()}@test.wolfiax.dev`, role: 'agent' })
      .expect(201);
    const rawToken = created.body.accept_url.split('/invite/')[1];
    const agent = await request(app.getHttpServer())
      .post(`/api/v1/auth/invitations/${rawToken}/accept`)
      .send({ full_name: 'Agente', password: 'password-larguisima-4' })
      .expect(200);

    // El agent no puede invitar (403 por RolesGuard)
    await request(app.getHttpServer())
      .post(`/api/v1/orgs/${tenantA.orgId}/invitations`)
      .set('Authorization', `Bearer ${agent.body.access_token}`)
      .send({ email: 'x@test.wolfiax.dev', role: 'agent' })
      .expect(403);

    // Ni cambiar el rol del owner
    await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${tenantA.orgId}/members/${tenantA.userId}`)
      .set('Authorization', `Bearer ${agent.body.access_token}`)
      .send({ role: 'analyst' })
      .expect(403);
  });

  it('el último owner no puede eliminarse a sí mismo', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${tenantB.orgId}/members/${tenantB.userId}`)
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .expect(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
  });
});
