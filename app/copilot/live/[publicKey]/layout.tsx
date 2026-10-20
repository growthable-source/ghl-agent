/**
 * Metadata for the public Co-Pilot launch page (a client component, so
 * it otherwise inherits the root marketing title). Same rule as the
 * widget pages: customer brand when white-labelled, else the agent's
 * name — never our SEO copy on a customer's session tab.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { visitorPageBrandMetadata } from '@/lib/domains/host-brand'

type Params = { params: Promise<{ publicKey: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { publicKey } = await params
  const agent = await db.copilotAgent
    .findFirst({ where: { publicKey, published: true }, select: { workspaceId: true, name: true } })
    .catch(() => null)
  const branded = await visitorPageBrandMetadata((await headers()).get('host'), agent?.workspaceId)
  if (branded) return branded
  return {
    title: { absolute: agent?.name ? `Live help · ${agent.name}` : 'Live help' },
    description: null,
    robots: { index: false, follow: false },
  }
}

export default function CopilotLiveLayout({ children }: { children: React.ReactNode }) {
  return children
}
