/**
 * Filter incoming brand IDs down to those allowed (a portal's catalog,
 * or a user's assignable set). Dedupes and drops any ID not in
 * `allowed`. Pure — the single source of truth for "which brand IDs
 * may this write touch", shared by the catalog, invite, and per-user
 * assignment routes.
 */
export function filterToAllowedBrands(incoming: string[], allowed: Set<string>): string[] {
  return Array.from(new Set(incoming.filter(id => allowed.has(id))))
}
