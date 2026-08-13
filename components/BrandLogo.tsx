'use client'

import Image from 'next/image'
import XoveraLogo from './XoveraLogo'
import type { DemoBrand } from '@/lib/demo-brands'

/**
 * Renders whichever logo the demo lander's brand carries.
 *
 * Xovera keeps going through XoveraLogo (multi-variant SVG set, theme
 * aware); whitelabel partners supply a single raster/vector asset under
 * /public/brands plus its aspect ratio, so width is derived from the
 * caller's height and the image never distorts.
 */
export default function BrandLogo({ brand, height = 24 }: { brand: DemoBrand; height?: number }) {
  if (brand.logo.kind === 'xovera') return <XoveraLogo height={height} />

  const { src, alt, aspect } = brand.logo
  return (
    <Image
      src={src}
      alt={alt}
      width={Math.round(height * aspect)}
      height={height}
      className="shrink-0"
      priority
    />
  )
}
