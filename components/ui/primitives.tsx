'use client'

import Link from 'next/link'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Xovera redesign primitives (handoff §2). Pure presentational — no data
 * fetching, so they can be used from server and client components alike.
 *
 * Colour rules (learned from globals.css): `bg-white` is remapped to the
 * brand-orange CTA and `text-white` to the primary text colour, so these
 * components NEVER use them. Surfaces use `bg-surface`, text on brand
 * fills uses `text-on-brand`. That also keeps the opt-in dark themes
 * working, since everything resolves through the theme variables.
 */

import { cx, buttonClass, type ButtonVariant, type ButtonSize } from '@/lib/ui-classes'

// ─── Button ────────────────────────────────────────────────────────────
// (class helpers live in lib/ui-classes — pure, callable from server components)


export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />
}

export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  className,
  children,
}: {
  href: string
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
  children: ReactNode
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  )
}

// ─── Card ──────────────────────────────────────────────────────────────

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('xv-card', className)}>{children}</div>
}

/** Section card: 44px header row with title + optional link/action. */
export function SectionCard({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={className}>
      <div className="h-11 px-4 flex items-center justify-between border-b border-border-theme">
        <h3 className="text-[14px] font-semibold text-text-primary">{title}</h3>
        {action && <div className="text-[12px] text-brand-500 font-medium">{action}</div>}
      </div>
      <div className={bodyClassName ?? 'p-4'}>{children}</div>
    </Card>
  )
}

// ─── PageHeader ────────────────────────────────────────────────────────

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-end justify-between gap-4 mb-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-text-tertiary">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** Uppercase 10.5px section label (also used for sidebar group headings). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('text-[10.5px] uppercase tracking-wider font-semibold text-text-muted', className)}>
      {children}
    </p>
  )
}

// ─── AlertBanner ───────────────────────────────────────────────────────

export function AlertBanner({
  lead,
  children,
  action,
  onDismiss,
  tone = 'warning',
}: {
  lead?: ReactNode
  children?: ReactNode
  /** Primary action — pass a <LinkButton>/<Button>; styled by the caller. */
  action?: ReactNode
  onDismiss?: () => void
  tone?: 'warning' | 'danger' | 'info'
}) {
  const tones = {
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    danger: 'bg-red-50 border-red-200 text-red-700',
    info: 'bg-sky-50 border-sky-200 text-sky-700',
  }
  return (
    <div
      role="alert"
      className={cx('flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]', tones[tone])}
    >
      <span aria-hidden className="shrink-0 text-base leading-none">⚠</span>
      <p className="flex-1 min-w-0">
        {lead && <strong className="font-semibold">{lead} </strong>}
        {children}
      </p>
      {action}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="text-[12.5px] font-medium hover:underline cursor-pointer">
          Dismiss
        </button>
      )}
    </div>
  )
}

// ─── Pills ─────────────────────────────────────────────────────────────

const PILL = 'inline-flex items-center gap-1.5 rounded-full border px-2 h-5 text-[11px] font-medium whitespace-nowrap'

export type StatusKind = 'live' | 'paused' | 'attention' | 'draft' | 'connected' | 'expired' | 'info'

const STATUS: Record<StatusKind, { cls: string; dot: string; label: string }> = {
  live: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500', label: 'Live' },
  connected: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500', label: 'Connected' },
  paused: { cls: 'bg-stone-50 border-stone-200 text-stone-600', dot: 'bg-stone-400', label: 'Paused' },
  draft: { cls: 'bg-stone-50 border-stone-200 text-stone-600', dot: 'bg-stone-400', label: 'Draft' },
  attention: { cls: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500', label: 'Needs attention' },
  expired: { cls: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500', label: 'Expired' },
  info: { cls: 'bg-sky-50 border-sky-200 text-sky-700', dot: 'bg-sky-500', label: 'Active' },
}

export function StatusBadge({ status, label }: { status: StatusKind; label?: string }) {
  const s = STATUS[status]
  return (
    <span className={cx(PILL, s.cls)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', s.dot)} />
      {label ?? s.label}
    </span>
  )
}

export function Pill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'ai' | 'brand'
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-stone-50 border-stone-200 text-stone-600',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    danger: 'bg-red-50 border-red-200 text-red-700',
    info: 'bg-sky-50 border-sky-200 text-sky-700',
    ai: 'bg-violet-50 border-violet-200 text-violet-700',
    brand: 'bg-brand-50 border-brand-200 text-brand-700',
  }
  return <span className={cx(PILL, tones[tone])}>{children}</span>
}

export type ChannelKind = 'sms' | 'whatsapp' | 'chat' | 'email' | 'voice'

const CHANNEL: Record<ChannelKind, { cls: string; label: string }> = {
  sms: { cls: 'bg-sky-50 border-sky-200 text-sky-700', label: 'SMS' },
  whatsapp: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', label: 'WhatsApp' },
  chat: { cls: 'bg-violet-50 border-violet-200 text-violet-700', label: 'Live Chat' },
  email: { cls: 'bg-stone-50 border-stone-200 text-stone-600', label: 'Email' },
  voice: { cls: 'bg-rose-50 border-rose-200 text-rose-700', label: 'Voice' },
}

export function ChannelPill({ channel }: { channel: ChannelKind }) {
  const c = CHANNEL[channel]
  return <span className={cx(PILL, c.cls)}>{c.label}</span>
}

// ─── Tabs / SegmentedControl ───────────────────────────────────────────

export interface TabItem {
  key: string
  label: string
  count?: number | null
  href?: string
}

/** Underline tabs. Link-based when `href` is set, otherwise buttons driven by `onChange`. */
export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[]
  active: string
  onChange?: (key: string) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cx('flex items-center gap-5 border-b border-border-theme', className)}>
      {items.map(t => {
        const isActive = t.key === active
        const cls = cx(
          'relative -mb-px h-9 inline-flex items-center gap-1.5 text-[13px] font-medium border-b-2 transition-colors cursor-pointer',
          isActive
            ? 'border-brand-500 text-text-primary'
            : 'border-transparent text-text-tertiary hover:text-text-primary',
        )
        const inner = (
          <>
            {t.label}
            {t.count != null && <span className="text-[11px] text-text-muted tabular-nums">{t.count}</span>}
          </>
        )
        return t.href ? (
          <Link key={t.key} href={t.href} role="tab" aria-selected={isActive} className={cls}>
            {inner}
          </Link>
        ) : (
          <button key={t.key} type="button" role="tab" aria-selected={isActive} onClick={() => onChange?.(t.key)} className={cls}>
            {inner}
          </button>
        )
      })}
    </div>
  )
}

/** Grey track, white active option. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  disabled = false,
  title,
}: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (v: T) => void
  className?: string
  /** Visible but inert — for controls whose data source doesn't exist yet. */
  disabled?: boolean
  title?: string
}) {
  return (
    <div title={title} className={cx('inline-flex items-center rounded-md bg-surface-secondary p-0.5', disabled && 'opacity-50', className)}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-7 px-2.5 rounded text-[12px] font-medium transition-colors',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            o.value === value ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── KpiTile ───────────────────────────────────────────────────────────

export function KpiTile({
  label,
  value,
  delta,
  deltaTone = 'positive',
  suffix,
}: {
  label: ReactNode
  value: ReactNode
  /** e.g. "+18.4%" — coloured by deltaTone. */
  delta?: ReactNode
  deltaTone?: 'positive' | 'negative' | 'warning' | 'neutral'
  /** Muted trailing text, e.g. "Scale plan". */
  suffix?: ReactNode
}) {
  const tone = {
    positive: 'text-emerald-600',
    negative: 'text-red-600',
    warning: 'text-amber-600',
    neutral: 'text-text-tertiary',
  }[deltaTone]
  return (
    <Card className="p-4">
      <p className="text-[12px] text-text-tertiary">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[22px] leading-none font-semibold tracking-tight text-text-primary tabular-nums">{value}</span>
        {delta != null && <span className={cx('text-[12px] font-medium tabular-nums', tone)}>{delta}</span>}
        {suffix != null && <span className="text-[12px] text-text-tertiary">{suffix}</span>}
      </div>
    </Card>
  )
}

// ─── Avatar ────────────────────────────────────────────────────────────

export function Avatar({
  name,
  src,
  size = 32,
  presence,
}: {
  name: string
  src?: string | null
  size?: number
  presence?: 'online' | 'away' | 'offline'
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]!.toUpperCase())
    .join('')
  const dot = { online: 'bg-emerald-500', away: 'bg-amber-500', offline: 'bg-stone-300' }
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-surface-secondary text-text-secondary font-semibold overflow-hidden"
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.36)) }}
      aria-label={name}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials || '?'
      )}
      {presence && (
        <span className={cx('absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-surface', dot[presence])} />
      )}
    </span>
  )
}

// ─── Health meter ──────────────────────────────────────────────────────

export function HealthMeter({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-text-muted">—</span>
  }
  const color = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-20 rounded-full bg-surface-secondary overflow-hidden">
        <span className={cx('block h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
      </span>
      <span className="tabular-nums text-text-secondary">{score}</span>
    </span>
  )
}
