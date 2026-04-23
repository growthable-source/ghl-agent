/**
 * Small "NEW" marker that decorates recently-added feature entry points
 * and automatically disappears after a cooldown (default 90 days).
 *
 * Usage:
 *   <button>
 *     Simulation swarm <NewBadge since="2026-04-23" />
 *   </button>
 *
 *   <Link href="/dashboard/.../simulations">
 *     Simulations <NewBadge since="2026-04-20" />
 *   </Link>
 *
 * Pick `since` = the date the feature shipped. The badge renders for
 * `days` days after that (default 90), then renders nothing — no
 * further code changes required. Applies the same accent color the
 * app uses for highlights (#fa4d2e) so "new" is consistent across
 * surfaces.
 *
 * Server-renderable: the decision is a pure date comparison, no
 * hooks or client-only APIs. Inline by default so it sits next to
 * its label without breaking layout.
 */

const DEFAULT_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

export default function NewBadge({
  since,
  days = DEFAULT_DAYS,
  className = '',
}: {
  /** ISO date string (YYYY-MM-DD) or Date. When the feature shipped. */
  since: string | Date
  /** How long the badge lives before auto-hiding. Defaults to 90 days. */
  days?: number
  /** Extra classes for tuning size/margin per surface. */
  className?: string
}) {
  const sinceDate = typeof since === 'string' ? new Date(since) : since
  if (isNaN(sinceDate.getTime())) return null
  const ageMs = Date.now() - sinceDate.getTime()
  if (ageMs > days * MS_PER_DAY) return null
  // Future-dated `since` also counts as "new" — renders the badge
  // until the date comes and goes. That's a minor edge case (a
  // feature announced in advance) and not worth a separate guard.

  return (
    <span
      className={`inline-flex items-center text-[9px] font-semibold uppercase tracking-wider rounded px-1 py-0.5 leading-none align-middle ${className}`}
      style={{ background: 'rgba(250,77,46,0.15)', color: '#fa4d2e' }}
      aria-label="New feature"
    >
      NEW
    </span>
  )
}
