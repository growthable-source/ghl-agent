/**
 * Growthable's public plans (growthable.io/pricing) — the language the
 * unlock speaks. A help-center customer is a GROWTHABLE customer;
 * Xovera is just the support engine behind their widget (we used to
 * use Intercom, now we use our own). So staff unlock people onto a
 * Growthable plan, and the internal Xovera entitlement is an
 * implementation detail: every unlock grants the full capability set
 * (Xovera 'scale' + ticketing) — the plan id is what we record and
 * display, not a feature matrix.
 *
 * Client-safe: labels only, imported by the admin UI and the unlock
 * route alike.
 */

export const GROWTHABLE_PLANS = [
  { id: 'agency_ai', label: 'Agency AI — $197/mo' },
  { id: 'wl_starter', label: 'WL Support Starter — $549/mo' },
  { id: 'wl_ultimate', label: 'WL Support Ultimate — $649/mo' },
  { id: 'wl_pro', label: 'WL Support Pro — $899/mo' },
  { id: 'agency_enterprise', label: 'Agency Enterprise — $2,000/mo' },
  { id: 'copilot', label: 'Co-Pilot — $199/mo' },
] as const

export type GrowthablePlanId = (typeof GROWTHABLE_PLANS)[number]['id']

export function growthablePlanLabel(id: string | undefined | null): string | null {
  return GROWTHABLE_PLANS.find(p => p.id === id)?.label ?? null
}

export function isGrowthablePlan(id: unknown): id is GrowthablePlanId {
  return typeof id === 'string' && GROWTHABLE_PLANS.some(p => p.id === id)
}
