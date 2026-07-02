'use client'

/**
 * Shared on/off switch. Extracted from the playbook rules page — the one
 * implementation whose knob is visible on every theme.
 *
 * Color rules (learned the hard way):
 *   - Knob is var(--btn-primary-text), NEVER `bg-white` — this codebase
 *     remaps bg-white to the brand-orange CTA color (globals.css), which
 *     makes a white knob vanish into an orange track.
 *   - OFF track is var(--toggle-off-bg), a purpose-built gray that stays
 *     visible on light themes (surface-tertiary is too faint there).
 *   - ON track defaults to emerald (state = "enabled/healthy"); pass
 *     onColor for surfaces where a different accent is established.
 */

export default function Toggle({
  checked,
  onChange,
  disabled = false,
  title,
  onColor = 'var(--accent-emerald)',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** Tooltip. Defaults to an on/off hint. */
  title?: string
  /** Track color when ON. Defaults to emerald. */
  onColor?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      title={title ?? (checked ? 'On — click to disable' : 'Off — click to enable')}
      className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: checked ? onColor : 'var(--toggle-off-bg)' }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full shadow transition-transform"
        style={{
          background: 'var(--btn-primary-text)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
        }}
      />
    </button>
  )
}
