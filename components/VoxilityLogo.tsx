'use client'

/**
 * Voxility brand logo — waveform circle mark + wordmark.
 *
 * Variants:
 *   mark   – circle icon only
 *   full   – icon + "VOXILITY" wordmark
 *   text   – "Voxility" in DM Sans (no icon)
 *
 * Themes:
 *   dark   – for dark backgrounds (default)
 *   light  – for light backgrounds
 */

interface VoxilityLogoProps {
  variant?: 'mark' | 'full' | 'text'
  size?: number           // height in px for the mark; font scales proportionally
  className?: string
  theme?: 'dark' | 'light'
}

export default function VoxilityLogo({
  variant = 'full',
  size = 32,
  className = '',
  theme = 'dark',
}: VoxilityLogoProps) {
  const gradientId = `vox-grad-${size}`
  const textColor = theme === 'dark' ? '#f8fafc' : '#1c1917'

  const mark = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <defs>
        <linearGradient id={gradientId} x1="15" y1="0" x2="85" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fa4d2e" />
          <stop offset="50%" stopColor="#fb8951" />
          <stop offset="100%" stopColor="#fbb040" />
        </linearGradient>
      </defs>

      {/* Outer circle */}
      <circle cx="50" cy="50" r="44" stroke={`url(#${gradientId})`} strokeWidth="5" fill="none" />

      {/* Waveform bars — 5 vertical rounded bars, varying heights */}
      <rect x="27" y="37" width="6" height="26" rx="3" fill={`url(#${gradientId})`} />
      <rect x="37" y="28" width="6" height="44" rx="3" fill={`url(#${gradientId})`} />
      <rect x="47" y="22" width="6" height="56" rx="3" fill={`url(#${gradientId})`} />
      <rect x="57" y="28" width="6" height="44" rx="3" fill={`url(#${gradientId})`} />
      <rect x="67" y="37" width="6" height="26" rx="3" fill={`url(#${gradientId})`} />
    </svg>
  )

  if (variant === 'mark') {
    return <span className={`inline-flex items-center ${className}`}>{mark}</span>
  }

  if (variant === 'text') {
    return (
      <span
        className={`inline-flex items-center font-bold tracking-tight ${className}`}
        style={{ color: textColor, fontSize: size * 0.55 }}
      >
        Voxility
      </span>
    )
  }

  // full — mark + wordmark
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {mark}
      <span
        className="font-bold tracking-tight"
        style={{ color: textColor, fontSize: size * 0.55 }}
      >
        Voxility
      </span>
    </span>
  )
}
