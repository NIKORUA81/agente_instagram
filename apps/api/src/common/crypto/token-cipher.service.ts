import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Env } from '../../config/configuration';

const IV_LENGTH = 12; // GCM estándar
const TAG_LENGTH = 16;

/**
 * Cifrado de tokens de Meta en reposo: AES-256-GCM.
 * Formato almacenado: [version(1) | iv(12) | authTag(16) | ciphertext].
 * El byte de versión permite rotar de clave/esquema sin migración big-bang
 * (v1 = clave maestra de TOKEN_ENC_KEY_BASE64; el envelope por-tenant del
 * doc 07 se introduce como v2 cuando haya KMS).
 */
@Injectable()
export class TokenCipherService {
  private readonly key: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const keyB64: string = config.get('TOKEN_ENC_KEY_BASE64', { infer: true });
    this.key = Buffer.from(keyB64, 'base64');
    if (this.key.length !== 32) {
      throw new Error(
        'TOKEN_ENC_KEY_BASE64 debe ser exactamente 32 bytes en base64 ' +
          '(genera una con infra/scripts/generate-jwt-keys.mjs)',
      );
    }
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(payload: Buffer | Uint8Array): string {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const version = buf[0];
    if (version !== 1) {
      throw new Error(`Versión de cifrado desconocida: ${version}`);
    }
    const iv = buf.subarray(1, 1 + IV_LENGTH);
    const tag = buf.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(1 + IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
