/**
 * Server-component-friendly Lucide icon picker.
 *
 * The visual brief picks icon names from lib/lucide-allowlist; the
 * spec stores them as strings. This component maps that string to
 * the actual lucide-react component and renders it in brand colour.
 *
 * Falls back to a generic `Circle` if the name isn't recognised
 * (e.g. older spec data from before the allowlist existed). The
 * fallback keeps the layout intact so a missing icon doesn't break
 * card rendering.
 */

import * as Lucide from 'lucide-react'
import type { CSSProperties } from 'react'

export interface LucideIconProps {
  /** Kebab-case Lucide name from lib/lucide-allowlist (e.g. 'shield-check'). */
  name?: string | null
  size?: number
  className?: string
  style?: CSSProperties
  /** When true, the icon is filled with currentColor; otherwise stroked. */
  filled?: boolean
}

// Normalise kebab-case → PascalCase so we can index into the
// lucide-react export map. 'shield-check' → 'ShieldCheck'.
function pascalCase(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

export function LucideIcon(props: LucideIconProps) {
  const { name, size = 22, className, style, filled } = props
  const lookup = name ? pascalCase(name) : null
  // Resolve the component by name — lucide-react exports each icon as
  // a PascalCase named export. Anything not in the export map falls
  // back to a CheckCircle shape (recognisable + neutral).
  const all = Lucide as unknown as Record<string, React.FC<{ size?: number; className?: string; style?: CSSProperties; strokeWidth?: number; fill?: string; absoluteStrokeWidth?: boolean }>>
  const Component = (lookup && all[lookup]) || all.CheckCircle || all.Check
  if (!Component) return null
  return (
    <Component
      size={size}
      className={className}
      style={style}
      strokeWidth={filled ? 1 : 2}
      fill={filled ? 'currentColor' : 'none'}
      absoluteStrokeWidth
    />
  )
}
