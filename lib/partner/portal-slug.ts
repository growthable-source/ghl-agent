import { createHash } from 'node:crypto'

/**
 * Deterministic, globally-unique-enough portal slug for a partner install.
 *
 * Portal.slug is globally unique and two agencies WILL both be called
 * "Acme Marketing", so the business name alone cannot be the slug. The
 * externalId is already the install's uniqueness anchor, so a short hash
 * of it makes the slug collision-free per install — and deterministic,
 * which is what lets a provisioning retry find the portal it half-built
 * instead of minting "acme-marketing-2".
 */
export function partnerPortalSlug(businessName: string, externalId: string): string {
  const base = businessName
    .toLowerCase()
    .normalize('NFKD')
    // Strip diacritics so "Café" slugs as "cafe", not "caf-".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  const suffix = createHash('sha256').update(externalId).digest('hex').slice(0, 6)
  return base ? `${base}-${suffix}` : `portal-${suffix}`
}
