/**
 * Pure diffing for agency-location sync. Separated from the DB writes in
 * lib/leadconnector-agency.ts so the remove/restore semantics are unit-
 * testable (vitest scope is lib/** pure helpers only).
 *
 * Semantics: sync never deletes. A location absent from the fetch gets
 * removedAt stamped (toggle preserved); a present location is upserted,
 * which also clears removedAt if it had been stamped before.
 */

export interface FetchedAgencyLocation {
  locationId: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  email: string | null
  phone: string | null
}

export interface ExistingAgencyLocationRow {
  locationId: string
  removedAt: Date | null
}

export interface AgencyLocationSyncPlan {
  upserts: FetchedAgencyLocation[]
  /** locationIds to stamp removedAt on (currently active but gone from the agency). */
  markRemoved: string[]
}

export function planAgencyLocationSync(
  existing: ExistingAgencyLocationRow[],
  fetchedList: FetchedAgencyLocation[],
): AgencyLocationSyncPlan {
  const seen = new Set<string>()
  const upserts: FetchedAgencyLocation[] = []
  for (const f of fetchedList) {
    if (seen.has(f.locationId)) continue
    seen.add(f.locationId)
    upserts.push(f)
  }
  const markRemoved = existing
    .filter(e => e.removedAt === null && !seen.has(e.locationId))
    .map(e => e.locationId)
  return { upserts, markRemoved }
}
