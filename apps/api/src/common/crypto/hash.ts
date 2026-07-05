import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 hex — para almacenar refresh tokens y tokens de invitación. */
export function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Token opaco URL-safe de alta entropía (48 bytes ≈ 64 chars base64url). */
export function generateOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(48).toString('base64url');
  return { raw, hash: sha256hex(raw) };
}
