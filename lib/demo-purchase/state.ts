/**
 * Purchase state machine for the /try/[slug] embedded-checkout bundle.
 *
 * All provisioning state lives in `DemoProspect.metadata.purchase` — a
 * JSON sub-object alongside whatever free-form fields the prospecting
 * tool already writes to `metadata` (see prisma/schema.prisma's comment
 * on DemoProspect.metadata: "free-form from the prospecting tool;
 * string values become template vars"). Every write here MUST re-read
 * the current row and merge, never blind-overwrite `metadata`, so a
 * purchase never clobbers those keys.
 *
 * State machine:
 *   checkout_started → paid → account_ready → claimed → crm_provisioning
 *     → crm_ready | crm_failed
 *   crm_ready → number_purchasing → number_purchased | number_failed | number_deferred
 *   crm_failed → number_deferred
 *   number_purchased | number_failed | number_deferred → complete
 *
 * `advancePurchaseState` is the only place that writes `purchase.state`.
 * It CASes on the Postgres JSON path `['purchase','state']` equaling the
 * expected `fromState` (Prisma JSON path filters — see
 * lib/meta-token-store.ts / lib/copilot/session-service.ts for existing
 * precedent on this exact syntax against a Json column). Two concurrent
 * writers (e.g. Stripe redelivering `checkout.session.completed`) race
 * on that `updateMany`; the loser's `count` comes back 0 and it re-reads
 * the fresh row instead of clobbering the winner's write. Callers
 * (lib/demo-purchase/fulfill.ts) are written to be resumable from
 * whatever state a fresh read shows — not just "retry the same CAS" —
 * so a double-delivered webhook that loses every CAS still safely no-ops
 * once the state it observes is already past the stage it wanted to run.
 *
 * `fromState: null` is the one non-CAS path — used only when a prospect
 * has no `purchase` key at all yet (defensive: in normal operation
 * app/api/public/try/[slug]/purchase/checkout-session/route.ts always
 * writes `checkout_started` before Stripe can ever complete a session,
 * so this should be unreachable in practice).
 */
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

export type PurchaseState =
  | 'checkout_started'
  | 'paid'
  | 'account_ready'
  | 'claimed'
  | 'crm_provisioning'
  | 'crm_ready'
  | 'crm_failed'
  | 'number_purchasing'
  | 'number_purchased'
  | 'number_failed'
  | 'number_deferred'
  | 'complete'

export type PurchasePeriod = 'monthly' | 'annual'

export interface ConciergeFlag {
  stage: string
  reason: string
  flaggedAt: string
}

export interface PurchaseMetadata {
  state: PurchaseState
  period: PurchasePeriod
  contactEmail?: string | null
  contactName?: string | null
  startedAt: string
  paidAt?: string
  stripeSessionId?: string
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  userId?: string
  workspaceId?: string
  locationId?: string
  phoneNumber?: string | null
  concierge?: ConciergeFlag | null
  magicLinkSentAt?: string
  /** Best-effort counter for the numbers/route.ts rate cap (~20 searches
   *  per prospect). Bumped via re-read+merge like every other field here
   *  — a lost race under concurrent polling just makes the cap slightly
   *  soft, never wrong in the "blocks a legitimate buyer" direction. */
  numberSearchCount?: number
  updatedAt: string
}

/** Legal forward transitions. Used defensively inside advancePurchaseState
 *  (and directly by state.test.ts) — the actual "from" gate for any given
 *  call site is the explicit `fromState` argument, this table just catches
 *  a caller asking for a transition that doesn't exist in the pipeline. */
export const ALLOWED_TRANSITIONS: Record<PurchaseState, PurchaseState[]> = {
  checkout_started: ['paid'],
  paid: ['account_ready'],
  account_ready: ['claimed'],
  claimed: ['crm_provisioning'],
  crm_provisioning: ['crm_ready', 'crm_failed'],
  crm_ready: ['number_purchasing'],
  crm_failed: ['number_deferred'],
  number_purchasing: ['number_purchased', 'number_failed', 'number_deferred'],
  number_purchased: ['complete'],
  number_failed: ['complete'],
  number_deferred: ['complete'],
  complete: [],
}

export function canTransition(from: PurchaseState, to: PurchaseState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/** Read the purchase sub-object off a DemoProspect.metadata Json value.
 *  Pure — safe to call on data from either the DB or a test fixture. */
export function getPurchase(metadata: unknown): PurchaseMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const p = (metadata as Record<string, unknown>).purchase
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  return p as PurchaseMetadata
}

/**
 * Re-read-and-merge: returns a NEW metadata object with every existing
 * top-level key preserved (prospecting-tool fields included) and
 * `purchase` shallow-merged with `patch`. Pure — no db access.
 */
export function mergePurchaseMetadata(
  existing: unknown,
  patch: Partial<PurchaseMetadata>,
): Record<string, unknown> & { purchase: PurchaseMetadata } {
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {}
  const currentPurchase =
    base.purchase && typeof base.purchase === 'object' && !Array.isArray(base.purchase)
      ? (base.purchase as Record<string, unknown>)
      : {}
  base.purchase = {
    ...currentPurchase,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  return base as Record<string, unknown> & { purchase: PurchaseMetadata }
}

/** Prisma's Json input type doesn't structurally accept a plain
 *  Record<string, unknown> without a cast — the value is always a JSON
 *  plain-object built by mergePurchaseMetadata above, so this is safe. */
function asJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

/**
 * Public projection for polling clients. Redacts everything that isn't
 * safe to hand to an anonymous poller holding just a slug/session-id —
 * no email, no Stripe ids, no internal userId/workspaceId/locationId.
 * `phoneNumber` only ever surfaces once a number is actually purchased.
 */
export interface PurchaseProjection {
  state: PurchaseState
  period: PurchasePeriod
  concierge: boolean
  phoneNumber: string | null
}

export function projectPurchase(purchase: PurchaseMetadata | null | undefined): PurchaseProjection | null {
  if (!purchase) return null
  return {
    state: purchase.state,
    period: purchase.period,
    concierge: Boolean(purchase.concierge),
    phoneNumber: purchase.state === 'number_purchased' ? purchase.phoneNumber ?? null : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// DB-touching helpers below this line — not covered by state.test.ts
// (vitest scope is lib/**/*.test.ts pure helpers only; see vitest.config.ts).
// ─────────────────────────────────────────────────────────────────────────

export type StartCheckoutResult =
  | { ok: true; prospectId: string; purchase: PurchaseMetadata }
  | { ok: false; reason: 'not_found' | 'gone' | 'already_purchased' }

/**
 * Initialize or update the `checkout_started` stage. Called from the
 * checkout-session route on every POST — including a monthly/annual
 * toggle flip before the buyer has paid, which just re-writes period
 * in place. Not a CAS (nothing to race against yet: this is the very
 * first write of `purchase` for a given prospect, and re-POSTs prior to
 * payment are idempotent by construction — last write wins on fields
 * that are purely UI state).
 */
export async function startOrUpdateCheckout(
  slug: string,
  input: { period: PurchasePeriod; contactEmail?: string | null; contactName?: string | null },
  extendExpiresAtMs: number,
): Promise<StartCheckoutResult> {
  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return { ok: false, reason: 'not_found' }
  if (prospect.status === 'expired' || prospect.status === 'claimed') {
    return { ok: false, reason: 'gone' }
  }

  const existing = getPurchase(prospect.metadata)
  if (existing && existing.state !== 'checkout_started') {
    // Already paid (or further along) — don't let a re-visit or a
    // replayed form post spin up a second Stripe session for the same
    // prospect.
    return { ok: false, reason: 'already_purchased' }
  }

  const patch: Partial<PurchaseMetadata> = {
    state: 'checkout_started',
    period: input.period,
    contactEmail: input.contactEmail ?? existing?.contactEmail ?? null,
    contactName: input.contactName ?? existing?.contactName ?? null,
    startedAt: existing?.startedAt ?? new Date().toISOString(),
  }
  const merged = mergePurchaseMetadata(prospect.metadata, patch)
  await db.demoProspect.update({
    where: { id: prospect.id },
    data: { metadata: asJsonInput(merged), expiresAt: new Date(Date.now() + extendExpiresAtMs) },
  })
  return { ok: true, prospectId: prospect.id, purchase: merged.purchase }
}

export interface AdvanceResult {
  ok: boolean
  purchase: PurchaseMetadata | null
}

/**
 * CAS-advance `purchase.state` from `fromState` to `toState`, merging
 * `patch` into the purchase object. On CAS loss (or when `fromState`
 * turns out not to match the current row — a concurrent writer beat us
 * there), re-reads and returns the FRESH purchase with `ok: false` so
 * callers can resume the pipeline from wherever it actually is instead
 * of erroring.
 */
export async function advancePurchaseState(
  prospectId: string,
  fromState: PurchaseState | null,
  toState: PurchaseState,
  patch: Partial<PurchaseMetadata> = {},
): Promise<AdvanceResult> {
  const current = await db.demoProspect.findUnique({
    where: { id: prospectId },
    select: { metadata: true },
  })
  if (!current) return { ok: false, purchase: null }

  const currentPurchase = getPurchase(current.metadata)

  if (fromState === null) {
    // Defensive-only path: no purchase key exists yet. Nothing to CAS
    // against, so this is a plain write (see module doc comment).
    if (currentPurchase) return { ok: false, purchase: currentPurchase }
    const merged = mergePurchaseMetadata(current.metadata, { ...patch, state: toState })
    await db.demoProspect.update({ where: { id: prospectId }, data: { metadata: asJsonInput(merged) } })
    return { ok: true, purchase: merged.purchase }
  }

  if (!currentPurchase || currentPurchase.state !== fromState) {
    // Either already advanced past fromState (double delivery — resume
    // from here) or something unexpected. Either way, hand back the
    // real current state rather than pretending the CAS could succeed.
    return { ok: false, purchase: currentPurchase }
  }

  const merged = mergePurchaseMetadata(current.metadata, { ...patch, state: toState })
  const cas = await db.demoProspect.updateMany({
    where: { id: prospectId, metadata: { path: ['purchase', 'state'], equals: fromState } },
    data: { metadata: asJsonInput(merged) },
  })
  if (cas.count === 0) {
    const fresh = await db.demoProspect.findUnique({ where: { id: prospectId }, select: { metadata: true } })
    return { ok: false, purchase: fresh ? getPurchase(fresh.metadata) : null }
  }
  return { ok: true, purchase: merged.purchase }
}
