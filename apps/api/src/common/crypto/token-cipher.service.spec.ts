import type { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { TokenCipherService } from './token-cipher.service';

function buildService(key?: string): TokenCipherService {
  const config = {
    get: jest.fn().mockReturnValue(key ?? randomBytes(32).toString('base64')),
  } as unknown as ConfigService;
  return new TokenCipherService(config as never);
}

describe('TokenCipherService', () => {
  it('cifra y descifra (roundtrip)', () => {
    const service = buildService();
    const token = 'IGQVJXlongLivedMetaToken.' + randomBytes(64).toString('base64url');
    const enc = service.encrypt(token);
    expect(service.decrypt(enc)).toBe(token);
  });

  it('el ciphertext nunca contiene el token en claro y es distinto por IV', () => {
    const service = buildService();
    const enc1 = service.encrypt('mismo-token');
    const enc2 = service.encrypt('mismo-token');
    expect(enc1.toString('latin1')).not.toContain('mismo-token');
    expect(enc1.equals(enc2)).toBe(false);
  });

  it('falla ante manipulación (integridad GCM)', () => {
    const service = buildService();
    const enc = service.encrypt('token-secreto');
    enc[enc.length - 1] ^= 0xff;
    expect(() => service.decrypt(enc)).toThrow();
  });

  it('rechaza claves que no son de 32 bytes', () => {
    expect(() => buildService(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  it('rechaza versiones de esquema desconocidas', () => {
    const service = buildService();
    const enc = service.encrypt('x');
    enc[0] = 9;
    expect(() => service.decrypt(enc)).toThrow(/desconocida/);
  });
});
