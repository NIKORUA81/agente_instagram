import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Hashing de contraseñas con Argon2id (parámetros OWASP 2024:
 * 19 MiB de memoria, 2 iteraciones, paralelismo 1).
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }
}
