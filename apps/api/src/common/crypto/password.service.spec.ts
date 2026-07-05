import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashea y verifica una contraseña correcta', async () => {
    const hash = await service.hash('contraseña-super-secreta');
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'contraseña-super-secreta')).resolves.toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await service.hash('contraseña-super-secreta');
    await expect(service.verify(hash, 'otra-contraseña')).resolves.toBe(false);
  });

  it('no revienta ante un hash corrupto', async () => {
    await expect(service.verify('no-es-un-hash', 'x')).resolves.toBe(false);
  });

  it('genera hashes distintos para la misma contraseña (salt aleatoria)', async () => {
    const [a, b] = await Promise.all([service.hash('misma'), service.hash('misma')]);
    expect(a).not.toEqual(b);
  });
});
