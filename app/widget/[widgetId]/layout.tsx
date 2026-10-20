/**
 * Metadata for the visitor-facing widget pages (/embed, /call, /live).
 * They're client components, so the tab title used to fall through to
 * the root marketing default — "Xovera — AI Agents for Sales…" — on a
 * customer's own live-help tab. Branded when white-labelled; otherwise
 * the widget's own title, never our SEO copy.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { visitorPageBrandMetadata } from '@/lib/domains/host-brand'

type Params = { params: Promise<{ widgetId: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { widgetId } = await params
  const widget = await db.chatWidget
    .findUnique({ where: { id: widgetId }, select: { workspaceId: true, title: true, name: true } })
    .catch(() => null)
  const branded = await visitorPageBrandMetadata((await headers()).get('host'), widget?.workspaceId)
  if (branded) return branded
  return {
    title: { absolute: widget?.title || widget?.name || 'Chat' },
    description: null,
    robots: { index: false, follow: false },
  }
}

export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return children
}
