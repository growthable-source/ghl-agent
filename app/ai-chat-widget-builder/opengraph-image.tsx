import { marketingOg, OG_SIZE, OG_CONTENT_TYPE } from '@/lib/og-template'
import { findSolution } from '@/lib/solutions-data'

export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE
export const alt = 'AI chat widget builder — Voxility'

export default function Og() {
  const s = findSolution('ai-chat-widget-builder')
  return marketingOg({ eyebrow: s?.eyebrow ?? 'Voxility', title: s?.heading ?? 'Voxility' })
}
