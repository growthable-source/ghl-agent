/**
 * Pure class-name helpers for the redesign primitives. Deliberately NOT in
 * components/ui/primitives.tsx: that file is 'use client', and non-component
 * exports of a client module become opaque client references that server
 * components can't call (`dataTable.tr()` / `buttonClass()` would throw).
 */

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ')

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm'

export const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
export const BTN_SIZE: Record<ButtonSize, string> = {
  md: 'h-8 px-3 text-[12.5px]',
  sm: 'h-7 px-2.5 text-[12px]',
}
export const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-500 text-on-brand hover:bg-brand-600 active:bg-brand-700',
  secondary: 'bg-surface text-text-primary border border-border-theme hover:bg-surface-secondary',
  ghost: 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary',
  danger: 'bg-red-50 text-red-700 hover:bg-red-100',
}

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cx(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], extra)
}


// ─── DataTable styling ─────────────────────────────────────────────────
// Presentation-only class helpers: pages keep their own data/column logic
// and just adopt the look (uppercase 11px header, 36px head, hover rows,
// brand-50 selected rows).

export const dataTable = {
  wrap: 'xv-card overflow-hidden',
  table: 'w-full text-[13px] text-text-primary',
  thead: 'bg-surface border-b border-border-theme',
  th: 'h-9 px-4 text-left text-[11px] uppercase tracking-wider font-semibold text-text-muted',
  tr: (selected?: boolean) =>
    cx('border-b border-border-theme last:border-0 transition-colors', selected ? 'bg-brand-50' : 'hover:bg-surface-secondary/60'),
  td: 'px-4 py-3 align-middle',
  num: 'tabular-nums',
}

