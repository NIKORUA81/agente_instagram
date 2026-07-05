import { randomBytes } from 'node:crypto';

/**
 * Slug URL-safe a partir del nombre de la organizacion + sufijo aleatorio
 * para garantizar unicidad sin round-trip a la BD.
 * "Cafe Paris S.A." -> "cafe-paris-s-a-x7k2"
 */
export function orgSlug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos (marcas combinantes NFD)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = randomBytes(3).toString('hex').slice(0, 4);
  return base.length > 0 ? `${base}-${suffix}` : `org-${suffix}`;
}
