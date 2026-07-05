#!/usr/bin/env node
/**
 * Genera el par de claves RS256 para los access tokens y lo imprime en el
 * formato listo para pegar en apps/api/.env.
 *
 *   node infra/scripts/generate-jwt-keys.mjs
 */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

console.log('# Pega estas líneas en apps/api/.env (NUNCA las commitees):\n');
console.log(`JWT_PRIVATE_KEY_BASE64=${Buffer.from(privateKey).toString('base64')}`);
console.log(`JWT_PUBLIC_KEY_BASE64=${Buffer.from(publicKey).toString('base64')}`);
