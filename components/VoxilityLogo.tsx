'use client'

import Image from 'next/image'

/**
 * Voxility brand logo — uses the actual corporate identity SVGs.
 *
 * Variants:
 *   mark   – waveform circle icon only (/logo-mark.svg)
 *   full   – full wordmark logo (/logo-color.svg or /logo-black.svg)
 *
 * Theme:
 *   dark   – color gradient on dark background (default)
 *   light  – black version for light backgrounds
 */

interface VoxilityLogoProps {
  variant?: 'mark' | 'full'
  height?: number
  className?: string
  theme?: 'dark' | 'light'
}

export default function VoxilityLogo({
  variant = 'full',
  height = 32,
  className = '',
  theme = 'dark',
}: VoxilityLogoProps) {
  if (variant === 'mark') {
    return (
      <Image
        src="/logo-mark.svg"
        alt="Voxility"
        width={height}
        height={height}
        className={`shrink-0 ${className}`}
        priority
      />
    )
  }

  // Full wordmark — aspect ratio is ~3.32:1 (3177 x 957)
  const width = Math.round(height * 3.32)
  const src = theme === 'light' ? '/logo-black.svg' : '/logo-color.svg'

  return (
    <Image
      src={src}
      alt="Voxility"
      width={width}
      height={height}
      className={`shrink-0 ${className}`}
      priority
    />
  )
}
