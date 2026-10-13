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

// Redesign palette (handoff §1): emerald = healthy, amber = needs attention,
// stone = neutral, brand = informational.
const TONE: Record<StatusTone, { cls: string; dot: string }> = {
  live: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500' },
  warn: { cls: 'bg-amber-50 border-amber-200 text-amber-700',       dot: 'bg-amber-500' },
  idle: { cls: 'bg-stone-50 border-stone-200 text-stone-600',       dot: 'bg-stone-400' },
  info: { cls: 'bg-brand-50 border-brand-200 text-brand-700',       dot: 'bg-brand-500' },
}

export function StatusPill({
  tone, label, hint,
}: { tone: StatusTone; label: string; hint?: string }) {
  const t = TONE[tone]
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-5 text-[11px] font-medium px-2 rounded-full border whitespace-nowrap ${t.cls}`}
      title={hint}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${t.dot}`} />
      {label}
    </span>
  )
}

// ─── OverviewSection ────────────────────────────────────────────────────────
// Card with a 44px header (title + optional pill + edit link) and arbitrary
// body content. Used as the unit of an Overview page.

export function OverviewSection({
  title, subtitle, pill, editHref, editLabel = 'Edit', children, className,
}: {
  title: string
  subtitle?: string
  pill?: { tone: StatusTone; label: string; hint?: string }
  editHref?: string
  editLabel?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`xv-card ${className ?? ''}`}>
      <header className="flex items-center justify-between gap-3 px-4 h-11 border-b border-border-theme">
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="text-[14px] font-semibold truncate text-text-primary">{title}</h3>
          {pill && <StatusPill tone={pill.tone} label={pill.label} hint={pill.hint} />}
        </div>
        {editHref && (
          <Link href={editHref} className="text-[12px] font-medium text-brand-500 hover:text-brand-600 shrink-0">
            {editLabel} →
          </Link>
        )}
      </header>
      {subtitle && <p className="text-[12px] px-4 pt-3 text-text-tertiary">{subtitle}</p>}
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

// ─── OverviewRow ────────────────────────────────────────────────────────────
// A label + value row inside a section; rows are separated by hairlines.

export function OverviewRow({
  label, value, muted,
}: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-[13px] border-b border-border-theme last:border-0">
      <span className="text-text-secondary">{label}</span>
      <span className={`text-right truncate font-medium ${muted ? 'text-text-tertiary !font-normal' : 'text-text-primary'}`}>
        {value}
      </span>
    </div>
  )
}

// ─── EmptyHint ──────────────────────────────────────────────────────────────

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-text-tertiary">{children}</p>
}

// ─── Tag ────────────────────────────────────────────────────────────────────
// Inline pill for lists of items inside a section (channels, tags, days).

export function Tag({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' }) {
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium px-2 h-5 rounded-full border ${
        tone === 'accent' ? 'bg-brand-50 border-brand-200 text-brand-700' : 'bg-stone-50 border-stone-200 text-stone-600'
      }`}
    >
      {children}
    </span>
  )
}
