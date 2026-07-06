import { createHmac } from 'node:crypto';
import { verifyMetaSignature } from './meta-signature.util';

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('verifyMetaSignature', () => {
  const body = JSON.stringify({ object: 'instagram', entry: [] });
  const secret = 'app-secret-de-prueba';

  it('acepta una firma válida', () => {
    expect(verifyMetaSignature(Buffer.from(body), sign(body, secret), [secret])).toBe(true);
  });

  it('acepta si coincide con CUALQUIERA de los secrets configurados', () => {
    expect(
      verifyMetaSignature(Buffer.from(body), sign(body, secret), ['otro-secret', secret]),
    ).toBe(true);
  });

  it('rechaza firma de otro secret', () => {
    expect(verifyMetaSignature(Buffer.from(body), sign(body, 'incorrecto'), [secret])).toBe(false);
  });

  it('rechaza cuerpo alterado', () => {
    expect(
      verifyMetaSignature(Buffer.from(body + 'x'), sign(body, secret), [secret]),
    ).toBe(false);
  });

  it('rechaza header ausente, malformado o sin prefijo', () => {
    expect(verifyMetaSignature(Buffer.from(body), undefined, [secret])).toBe(false);
    expect(verifyMetaSignature(Buffer.from(body), 'sha1=abc', [secret])).toBe(false);
    expect(verifyMetaSignature(Buffer.from(body), 'sha256=zz', [secret])).toBe(false);
  });

  it('rechaza cuando no hay body crudo o no hay secrets', () => {
    expect(verifyMetaSignature(undefined, sign(body, secret), [secret])).toBe(false);
    expect(verifyMetaSignature(Buffer.from(body), sign(body, secret), [])).toBe(false);
  });
});
