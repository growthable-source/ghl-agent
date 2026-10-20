import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { hostMayServeWorkspace } from '@/lib/domains/workspace-domain'
import { customHostOrigin, visitorPageBrand } from '@/lib/domains/host-brand'
import { brandedPageTitle, brandMetadata } from '@/lib/domains/brand-metadata'
import { widgetPoweredByLine } from '@/lib/widget-powered-by'
import HostedCallClient from './HostedCallClient'
import type { Metadata } from 'next'

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const w = await db.chatWidget.findUnique({
    where: { slug },
    select: { name: true, workspaceId: true, hostedPageHeadline: true, hostedPageSubtext: true, isActive: true },
  }).catch(() => null)
  if (!w || !w.isActive) return { title: { absolute: 'Not found' } }
  const title = w.hostedPageHeadline || `Talk to ${w.name}`
  const description = w.hostedPageSubtext || 'Tap to start a voice call.'
  // Branded: "<headline> | <Brand>". Otherwise absolute — the root
  // template would append "| Xovera" to a customer's own call page.
  const host = (await headers()).get('host')
  const brand = await visitorPageBrand(host, w.workspaceId)
  if (brand) {
    const md = brandMetadata(brand, customHostOrigin(host))
    return { ...md, title: brandedPageTitle(brand, title), description, openGraph: { ...md.openGraph, title, description } }
  }
  return { title: { absolute: title }, description, openGraph: { title, description } }
}

export default async function HostedCallPage({ params }: Params) {
  const { slug } = await params
  const widget = await db.chatWidget.findUnique({
    where: { slug },
    select: {
      id: true, workspaceId: true, publicKey: true, name: true, type: true, isActive: true,
      primaryColor: true, logoUrl: true,
      buttonLabel: true, buttonShape: true, buttonSize: true, buttonIcon: true, buttonTextColor: true,
      hostedPageHeadline: true, hostedPageSubtext: true, poweredByText: true,
    },
  }).catch(() => null)

  if (!widget || !widget.isActive) notFound()
  if (!(await hostMayServeWorkspace((await headers()).get('host'), widget.workspaceId))) notFound()
  const workspace = await db.workspace.findUnique({ where: { id: widget.workspaceId }, select: { plan: true } }).catch(() => null)

  return (
    <HostedCallClient
      widgetId={widget.id}
      publicKey={widget.publicKey}
      name={widget.name}
      type={widget.type as 'chat' | 'click_to_call'}
      primaryColor={widget.primaryColor}
      logoUrl={widget.logoUrl}
      buttonLabel={widget.buttonLabel}
      buttonTextColor={widget.buttonTextColor}
      headline={widget.hostedPageHeadline}
      subtext={widget.hostedPageSubtext}
      poweredBy={widgetPoweredByLine(workspace?.plan, widget.poweredByText)}
    />
  )
}
