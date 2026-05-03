/**
 * Reusable primitives for agent hub Overview pages (Identity, Knowledge,
 * Skills, Trigger, Activity). One visual language across all five so
 * operators don't have to relearn the page on every hub.
 */
import Link from 'next/link'

// ─── StatusPill ─────────────────────────────────────────────────────────────
// Colored chip with a leading dot. Variants are token-driven, so the pill
// reads correctly in both light and dark themes.

export type StatusTone = 'live' | 'warn' | 'idle' | 'info'

const TONE: Record<StatusTone, { bg: string; fg: string; dot: string }> = {
  live: { bg: 'var(--accent-emerald-bg)', fg: 'var(--accent-emerald)', dot: 'var(--accent-emerald)' },
  warn: { bg: 'var(--accent-amber-bg)',   fg: 'var(--accent-amber)',   dot: 'var(--accent-amber)'   },
  idle: { bg: 'var(--surface-secondary)', fg: 'var(--text-tertiary)',  dot: 'var(--text-tertiary)'  },
  info: { bg: 'var(--accent-primary-bg)', fg: 'var(--accent-primary)', dot: 'var(--accent-primary)' },
}

export function StatusPill({
  tone, label, hint,
}: { tone: StatusTone; label: string; hint?: string }) {
  const t = TONE[tone]
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: t.bg, color: t.fg }}
      title={hint}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: t.dot }} />
      {label}
    </span>
  )
}

// ─── OverviewSection ────────────────────────────────────────────────────────
// Card with a header (title + optional pill + edit link) and arbitrary body
// content. Used as the unit of an Overview page — five of these stacked is
// the whole page.

export function OverviewSection({
  title, subtitle, pill, editHref, editLabel = 'Edit', children,
}: {
  title: string
  subtitle?: string
  pill?: { tone: StatusTone; label: string; hint?: string }
  editHref?: string
  editLabel?: string
  children: React.ReactNode
}) {
  return (
    <section
      className="rounded-xl border"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <header
        className="flex items-center justify-between gap-3 px-5 py-3.5 border-b"
        style={{ borderColor: 'var(--border-secondary)' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          {pill && <StatusPill tone={pill.tone} label={pill.label} hint={pill.hint} />}
        </div>
        {editHref && (
          <Link
            href={editHref}
            className="text-xs font-medium transition-opacity hover:opacity-80 shrink-0"
            style={{ color: 'var(--accent-primary)' }}
          >
            {editLabel} →
          </Link>
        )}
      </header>
      {subtitle && (
        <p
          className="text-xs px-5 pt-3"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {subtitle}
        </p>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

// ─── OverviewRow ────────────────────────────────────────────────────────────
// A label + value row inside a section. Used for "channels: SMS, Email"
// type listings where the value is a short string or list.

export function OverviewRow({
  label, value, muted,
}: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </span>
      <span
        className="text-right truncate"
        style={{ color: muted ? 'var(--text-tertiary)' : 'var(--text-primary)' }}
      >
        {value}
      </span>
    </div>
  )
}

// ─── EmptyHint ──────────────────────────────────────────────────────────────
// Subtle inline empty-state message for sections that have no data yet.
// Keeps the page from looking broken when the agent is half-configured.

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
      {children}
    </p>
  )
}

// ─── Tag ────────────────────────────────────────────────────────────────────
// Inline pill used to render lists of items inside a section (channel
// badges, tag values, day chips). Bigger than StatusPill, neutral tone.

export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md"
      style={
        tone === 'accent'
          ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
          : { background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }
      }
    >
      {children}
    </span>
  )
}
