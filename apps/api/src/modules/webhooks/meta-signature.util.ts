import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica X-Hub-Signature-256 ("sha256=<hmac hex>") contra el cuerpo CRUDO
 * del webhook, en tiempo constante. Se prueba contra todos los app secrets
 * configurados (app de Facebook y app de Instagram pueden diferir).
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  appSecrets: string[],
): boolean {
  if (!rawBody || !signatureHeader?.startsWith('sha256=')) return false;
  const provided = signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const providedBuf = Buffer.from(provided, 'hex');

  for (const secret of appSecrets) {
    if (!secret) continue;
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    if (expected.length === providedBuf.length && timingSafeEqual(expected, providedBuf)) {
      return true;
    }
  }
  return false;
}
