import { orgSlug } from './slug';

describe('orgSlug', () => {
  it('normaliza acentos y caracteres especiales', () => {
    const slug = orgSlug('Café París S.A.');
    expect(slug).toMatch(/^cafe-paris-s-a-[0-9a-f]{4}$/);
  });

  it('maneja nombres solo de símbolos', () => {
    expect(orgSlug('@@@')).toMatch(/^org-[0-9a-f]{4}$/);
  });

  it('trunca nombres largos a 40 chars de base', () => {
    const slug = orgSlug('a'.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(45);
  });

  it('produce slugs distintos para el mismo nombre', () => {
    expect(orgSlug('Wolfiax')).not.toEqual(orgSlug('Wolfiax'));
  });
});
