'use client'

/**
 * Renders a workspace's avatar — either the uploaded logo image or
 * the emoji fallback. Centralised here so every display point
 * (sidebar, switcher, workspace list) gets consistent behaviour.
 *
 * When `logoUrl` is set, we render an <img>. If it 404s or otherwise
 * fails to load, we fall back to the emoji via an onError handler
 * so a broken URL never results in an empty box.
 */

import { useState } from 'react'

interface Props {
  logoUrl?: string | null
  icon?: string | null
  size?: number           // px square
  className?: string
  title?: string
}

export default function WorkspaceAvatar({
  logoUrl,
  icon,
  size = 24,
  className = '',
  title,
}: Props) {
  const [failed, setFailed] = useState(false)
  const showLogo = !!logoUrl && !failed
  const fontSize = Math.round(size * 0.7)

  if (showLogo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl!}
        alt={title ?? 'Workspace logo'}
        title={title}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={`rounded object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize }}
      title={title}
      aria-label={title}
    >
      {icon || '🚀'}
    </span>
  )
}
