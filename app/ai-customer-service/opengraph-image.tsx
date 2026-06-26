import { marketingOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-template'
import { findSolution } from '@/lib/solutions-data'

export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'AI customer service — Xovera'

export default function Og() {
  const s = findSolution('ai-customer-service')
  return marketingOg({ eyebrow: s?.eyebrow ?? 'Xovera', title: s?.heading ?? 'Xovera' })
}
