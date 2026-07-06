/**
 * Entorno para e2e: genera claves RS256 efímeras y defaults locales.
 * Requiere un Postgres accesible (docker-compose.dev o servicio de CI)
 * con las migraciones aplicadas (prisma migrate deploy).
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT ?? '0';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://wolfiax:wolfiax_dev@localhost:5432/wolfiax';
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
process.env.SWAGGER_ENABLED = 'false';
// F1: cifrado de tokens y Redis (NODE_ENV=test desactiva el worker de BullMQ)
process.env.TOKEN_ENC_KEY_BASE64 =
  process.env.TOKEN_ENC_KEY_BASE64 ?? randomBytes(32).toString('base64');
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

if (!process.env.JWT_PRIVATE_KEY_BASE64) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from(privateKey).toString('base64');
  process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from(publicKey).toString('base64');
}
