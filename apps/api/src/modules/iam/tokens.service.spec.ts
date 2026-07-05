import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { AppError } from '../../common/errors/app-error';
import { TokensService } from './tokens.service';

function buildService(ttlSeconds = 900): TokensService {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const jwt = new JwtService({
    privateKey,
    publicKey,
    signOptions: { algorithm: 'RS256' },
    verifyOptions: { algorithms: ['RS256'] },
  });
  const config = {
    get: jest.fn().mockReturnValue(ttlSeconds),
  } as unknown as ConfigService;
  return new TokensService(jwt, config as never);
}

describe('TokensService', () => {
  const input = {
    userId: '3f2c9a34-0000-4000-8000-000000000001',
    organizationId: '3f2c9a34-0000-4000-8000-000000000002',
    role: 'owner' as const,
    email: 'ana@empresa.com',
  };

  it('firma y verifica un access token con los claims correctos', async () => {
    const service = buildService();
    const token = await service.signAccessToken(input);
    const payload = await service.verifyAccessToken(token);
    expect(payload.sub).toBe(input.userId);
    expect(payload.org).toBe(input.organizationId);
    expect(payload.role).toBe('owner');
    expect(payload.email).toBe(input.email);
    expect(payload.exp! - payload.iat!).toBe(900);
  });

  it('rechaza tokens firmados con otra clave', async () => {
    const serviceA = buildService();
    const serviceB = buildService();
    const token = await serviceA.signAccessToken(input);
    await expect(serviceB.verifyAccessToken(token)).rejects.toBeInstanceOf(AppError);
  });

  it('rechaza basura', async () => {
    const service = buildService();
    await expect(service.verifyAccessToken('garbage.token.here')).rejects.toBeInstanceOf(AppError);
  });
});
