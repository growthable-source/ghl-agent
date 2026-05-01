import Link from 'next/link'
import { db } from '@/lib/db'

/**
 * Channels — primary nav object. Shows the customer-communication
 * channels their agent is wired up to (Instagram DM, Facebook Messenger,
 * SMS, etc.), with shortcuts to connect more. CRM/payment/calendar
 * integrations live under More → Integrations; this page is intentionally
 * channels-only so it stays scannable.
 */
export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  // All locations under this workspace; integrations are keyed by
  // locationId so we collect them across the workspace's locations.
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  const integrations = locationIds.length
    ? await db.integration.findMany({
        where: { locationId: { in: locationIds } },
        orderBy: { createdAt: 'desc' },
      })
    : []

  // Per-channel activity signal — which channels actually have
  // conversations flowing in (not just OAuth'd but receiving messages).
  const liveChannels = locationIds.length
    ? await db.metaConversation.groupBy({
        by: ['channel'],
        where: { workspaceId },
        _count: { _all: true },
      })
    : []
  const messengerCount = liveChannels.find(c => c.channel === 'messenger')?._count._all ?? 0
  const instagramCount = liveChannels.find(c => c.channel === 'instagram')?._count._all ?? 0

  const metaIntegrations = integrations.filter(i => i.type === 'meta' && i.isActive)
  const twilioIntegrations = integrations.filter(i => i.type === 'twilio' && i.isActive)

  // Each Meta OAuth wires up a Facebook Page. If that page has an
  // Instagram Business account attached it serves IG too — we surface
  // both as separate channel cards because users think in terms of
  // "Instagram" and "Facebook", not "Meta".
  const facebookConnected = metaIntegrations.length > 0
  const instagramConnected = metaIntegrations.length > 0 // same OAuth covers both
  const smsConnected = twilioIntegrations.length > 0

  const integrationsHref = `/dashboard/${workspaceId}/integrations`

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Where your agent talks to customers. Connect a channel and your agent picks up the conversation automatically.
          </p>
        </div>

        {/* Connected */}
        <section className="mb-10">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Live
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <ChannelCard
              kind="instagram"
              title="Instagram DMs"
              status={instagramConnected ? 'connected' : 'available'}
              meta={instagramConnected
                ? `${instagramCount} ${instagramCount === 1 ? 'conversation' : 'conversations'}`
                : 'Reply to DMs on your Instagram business account'}
              cta={instagramConnected ? 'Manage' : 'Connect'}
              href={integrationsHref}
            />
            <ChannelCard
              kind="facebook"
              title="Facebook Messenger"
              status={facebookConnected ? 'connected' : 'available'}
              meta={facebookConnected
                ? `${messengerCount} ${messengerCount === 1 ? 'conversation' : 'conversations'}`
                : 'Reply to messages on your Facebook Page'}
              cta={facebookConnected ? 'Manage' : 'Connect'}
              href={integrationsHref}
            />
            <ChannelCard
              kind="sms"
              title="SMS"
              status={smsConnected ? 'connected' : 'available'}
              meta={smsConnected
                ? twilioIntegrations[0].name || 'Twilio'
                : 'Reply to inbound texts via Twilio'}
              cta={smsConnected ? 'Manage' : 'Connect'}
              href={integrationsHref}
            />
          </div>
        </section>

        {/* Coming soon */}
        <section className="mb-10">
          <h2 className="text-[11px] uppercase tracking-wider font-semibold mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Coming soon
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <ChannelCard
              kind="whatsapp"
              title="WhatsApp Business"
              status="coming-soon"
              meta="Reply to WhatsApp messages from a verified business number"
              cta="Notify me"
              href={integrationsHref}
            />
            <ChannelCard
              kind="webchat"
              title="Website chat"
              status="available"
              meta="Embed a chat widget on your site"
              cta="Set up"
              href={`/dashboard/${workspaceId}/widgets`}
            />
            <ChannelCard
              kind="email"
              title="Email"
              status="coming-soon"
              meta="Reply to inbound enquiries from a shared email inbox"
              cta="Notify me"
              href={integrationsHref}
            />
          </div>
        </section>

        {/* Footer link to advanced integrations */}
        <div
          className="rounded-xl border p-4 flex items-center justify-between"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div>
            <p className="text-sm font-medium">Looking for CRM, payments, or calendaring?</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Those live under Integrations — they don&apos;t carry conversations themselves.
            </p>
          </div>
          <Link
            href={integrationsHref}
            className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }}
          >
            Open Integrations →
          </Link>
        </div>
      </div>
    </div>
  )
}

type ChannelKind = 'instagram' | 'facebook' | 'sms' | 'whatsapp' | 'webchat' | 'email'
type ChannelStatus = 'connected' | 'available' | 'coming-soon'

function ChannelCard({
  kind,
  title,
  status,
  meta,
  cta,
  href,
}: {
  kind: ChannelKind
  title: string
  status: ChannelStatus
  meta: string
  cta: string
  href: string
}) {
  const disabled = status === 'coming-soon'
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-3"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface)',
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <div className="flex items-center justify-between">
        <ChannelGlyph kind={kind} />
        <StatusPill status={status} />
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>
          {meta}
        </p>
      </div>
      {!disabled ? (
        <Link
          href={href}
          className="self-start text-xs font-medium px-2.5 py-1 rounded-md transition-colors"
          style={{ color: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }}
        >
          {cta}
        </Link>
      ) : (
        <span
          className="self-start text-xs font-medium px-2.5 py-1 rounded-md"
          style={{ color: 'var(--text-tertiary)', background: 'var(--surface-secondary)' }}
        >
          {cta}
        </span>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: ChannelStatus }) {
  if (status === 'connected') {
    return (
      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
        style={{ color: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-emerald)' }} />
        Live
      </span>
    )
  }
  if (status === 'coming-soon') {
    return (
      <span
        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
        style={{ color: 'var(--text-tertiary)', background: 'var(--surface-secondary)' }}
      >
        Coming soon
      </span>
    )
  }
  return (
    <span
      className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ color: 'var(--text-tertiary)', background: 'var(--surface-secondary)' }}
    >
      Available
    </span>
  )
}

function ChannelGlyph({ kind }: { kind: ChannelKind }) {
  const wrap = 'w-9 h-9 rounded-lg flex items-center justify-center'
  switch (kind) {
    case 'instagram':
      return (
        <div
          className={wrap}
          style={{ background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 50%, #8134af 100%)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <rect x="2" y="2" width="20" height="20" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="0.6" fill="white" />
          </svg>
        </div>
      )
    case 'facebook':
      return (
        <div className={wrap} style={{ background: '#1877f2' }}>
          <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
            <path d="M24 12c0-6.63-5.37-12-12-12S0 5.37 0 12c0 5.99 4.39 10.95 10.13 11.85V15.47H7.08V12h3.05V9.36c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.23 2.69.23v2.95h-1.51c-1.49 0-1.96.93-1.96 1.88V12h3.33l-.53 3.47h-2.8v8.38C19.61 22.95 24 17.99 24 12z" />
          </svg>
        </div>
      )
    case 'sms':
      return (
        <div className={wrap} style={{ background: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </div>
      )
    case 'whatsapp':
      return (
        <div className={wrap} style={{ background: '#25d366' }}>
          <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
            <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.2-.4-2.4-1.4-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.2-.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-1-2.3-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4s-1 1-1 2.4 1.1 2.8 1.2 3c.1.2 2.1 3.2 5 4.5 2.9 1.3 2.9.8 3.4.8.5 0 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.4 5l-1 3.6 3.7-1c1.4.8 3.1 1.3 4.9 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
          </svg>
        </div>
      )
    case 'webchat':
      return (
        <div className={wrap} style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <path d="M7 22l5-4 5 4" />
          </svg>
        </div>
      )
    case 'email':
      return (
        <div className={wrap} style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M22 6l-10 7L2 6" />
          </svg>
        </div>
      )
  }
}
