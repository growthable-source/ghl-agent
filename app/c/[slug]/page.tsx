import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import HostedCallClient from './HostedCallClient'
import type { Metadata } from 'next'

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const w = await db.chatWidget.findUnique({
    where: { slug },
    select: { name: true, hostedPageHeadline: true, hostedPageSubtext: true, isActive: true },
  }).catch(() => null)
  if (!w || !w.isActive) return { title: 'Not found' }
  const title = w.hostedPageHeadline || `Talk to ${w.name}`
  const description = w.hostedPageSubtext || 'Tap to start a voice call.'
  return { title, description, openGraph: { title, description } }
}

export default async function HostedCallPage({ params }: Params) {
  const { slug } = await params
  const widget = await db.chatWidget.findUnique({
    where: { slug },
    select: {
      id: true, publicKey: true, name: true, type: true, isActive: true,
      primaryColor: true, logoUrl: true,
      buttonLabel: true, buttonShape: true, buttonSize: true, buttonIcon: true, buttonTextColor: true,
      hostedPageHeadline: true, hostedPageSubtext: true,
    },
  }).catch(() => null)

  if (!widget || !widget.isActive) notFound()

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
    />
  )
}
