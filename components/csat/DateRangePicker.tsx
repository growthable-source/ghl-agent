'use client'

/**
 * Date-window control: 7d / 30d / 90d preset toggle plus an explicit
 * from/to calendar pair when "Custom" is on. Mode is sticky — flipping
 * back to a preset keeps the typed custom dates available behind it.
 */

const WINDOWS = [7, 30, 90] as const

interface Props {
  mode: 'preset' | 'custom'
  days: 7 | 30 | 90
  customFrom: string
  customTo: string
  onPreset: (days: 7 | 30 | 90) => void
  onToggleCustom: () => void
  onCustomFrom: (iso: string) => void
  onCustomTo: (iso: string) => void
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function DateRangePicker({
  mode, days, customFrom, customTo,
  onPreset, onToggleCustom, onCustomFrom, onCustomTo,
}: Props) {
  return (
    <>
      <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
        {WINDOWS.map(w => (
          <button
            key={w}
            onClick={() => onPreset(w)}
            className="text-xs font-medium px-3 py-1 rounded-md transition-colors"
            style={
              mode === 'preset' && days === w
                ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                : { color: 'var(--text-tertiary)' }
            }
          >
            {w}d
          </button>
        ))}
        <button
          onClick={onToggleCustom}
          className="text-xs font-medium px-3 py-1 rounded-md transition-colors"
          style={
            mode === 'custom'
              ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
              : { color: 'var(--text-tertiary)' }
          }
          title="Custom date range"
        >
          📅 Custom
        </button>
      </div>
      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={e => onCustomFrom(e.target.value)}
            className="text-xs rounded-lg px-2 py-1.5"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>→</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            max={todayISO()}
            onChange={e => onCustomTo(e.target.value)}
            className="text-xs rounded-lg px-2 py-1.5"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
          />
        </div>
      )}
    </>
  )
}
