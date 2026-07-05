/**
 * Entorno para e2e: genera claves RS256 efímeras y defaults locales.
 * Requiere un Postgres accesible (docker-compose.dev o servicio de CI)
 * con las migraciones aplicadas (prisma migrate deploy).
 */
import { generateKeyPairSync } from 'node:crypto';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.PORT = process.env.PORT ?? '0';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://wolfiax:wolfiax_dev@localhost:5432/wolfiax';
process.env.WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
process.env.COOKIE_SECURE = 'false';
process.env.SWAGGER_ENABLED = 'false';

if (!process.env.JWT_PRIVATE_KEY_BASE64) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from(privateKey).toString('base64');
  process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from(publicKey).toString('base64');
}
