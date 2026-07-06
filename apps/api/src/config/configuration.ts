import { z } from 'zod';

/** 'true'/'false' explícitos — z.coerce.boolean() trataría 'false' como true. */
const boolString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  WEB_ORIGIN: z.string().url(),
  COOKIE_SECURE: boolString,
  COOKIE_DOMAIN: z.string().optional(),
  JWT_PRIVATE_KEY_BASE64: z.string().min(1, 'Genera las claves con infra/scripts/generate-jwt-keys.mjs'),
  JWT_PUBLIC_KEY_BASE64: z.string().min(1),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SWAGGER_ENABLED: boolString,

  // --- F1: rol del proceso, Redis, cifrado y Meta ---
  MODE: z.enum(['api', 'webhook', 'worker']).default('api'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** URL pública de la API (redirect_uri de OAuth). */
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** 32 bytes en base64 — AES-256-GCM para tokens de Meta en reposo. */
  TOKEN_ENC_KEY_BASE64: z
    .string()
    .min(1, 'Genera la clave con infra/scripts/generate-jwt-keys.mjs'),
  META_GRAPH_VERSION: z.string().default('v23.0'),
  /** App de Facebook (vía facebook_login). Opcionales hasta conectar canales. */
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** App de Instagram (vía instagram_login). */
  META_IG_APP_ID: z.string().optional(),
  META_IG_APP_SECRET: z.string().optional(),
  /** Verify token del webhook (elige un valor aleatorio y configúralo en Meta). */
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${issues}`);
  }
  return parsed.data;
}

/** Claves PEM decodificadas una sola vez. */
export function decodeJwtKeys(env: Env): { privateKey: string; publicKey: string } {
  return {
    privateKey: Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    publicKey: Buffer.from(env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8'),
  };
}
