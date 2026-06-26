import { marketingOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-template'
import { findAlternative } from '@/lib/alternatives-data'

export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'Intercom Fin alternative — Xovera'

export default function Og() {
  const a = findAlternative('fin-alternative')
  return marketingOg({ eyebrow: a?.eyebrow ?? 'Alternative', title: a?.heading ?? 'Xovera' })
}
