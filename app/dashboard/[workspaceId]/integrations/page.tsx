'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  LeadConnectorIcon, VapiIcon, TwilioIcon, HubSpotIcon,
  CalendlyIcon, CalcomIcon, StripeIcon, FacebookIcon, InstagramIcon,
} from '@/components/icons/brand-icons'
import NewBadge from '@/components/NewBadge'
import { useEmbedded } from '@/lib/embedded-context'
import { ConnectivityCheckPanel } from '@/components/dashboard/ConnectivityCheckPanel'

interface Integration {
  id: string
  type: string
  name: string
  isActive: boolean
  createdAt: string
}

interface MetaAdAccountRow {
  id: string
  accountName: string
  metaAccountId: string
  isActive: boolean
  autoPilotEnabled: boolean
  createdAt: string
  updatedAt: string
}

interface GoogleAdAccountRow {
  id: string
  accountName: string
  googleCustomerId: string
  isActive: boolean
  autoPilotEnabled: boolean
  createdAt: string
  updatedAt: string
}

export default function IntegrationsPage() {
  const params = useParams()
  const search = useSearchParams()
  const workspaceId = params.workspaceId as string
  // When loaded inside the LeadConnector iframe, this page collapses
  // to the bare minimum of "extras that complement GHL" — channels and
  // calendars are GHL's responsibility, the CRM is implicit. See the
  // Phase 5 plan for the rationale: in embed mode, Voxility is an
  // agent layer on top of GHL, not a standalone product.
  const { embedded } = useEmbedded()

  const [integrations, setIntegrations] = useState<Integration[]>([])
  // Banner state for the Meta OAuth callback redirect. Surface success
  // ("connected N Pages") or the specific error reason so the operator
  // doesn't have to dig through Vercel logs to figure out what went wrong.
  const [metaBanner, setMetaBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [disconnectingMeta, setDisconnectingMeta] = useState<string | null>(null)

  async function disconnectMetaPage(integrationId: string) {
    setDisconnectingMeta(integrationId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/integrations/${integrationId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to disconnect')
      }
      setIntegrations(prev => prev.filter(i => i.id !== integrationId))
    } catch (err: any) {
      setMetaBanner({ kind: 'error', text: `Disconnect failed: ${err.message}` })
    } finally {
      setDisconnectingMeta(null)
    }
  }
  const [ghlConnected, setGhlConnected] = useState(false)
  const [vapiActive, setVapiActive] = useState(false)
  const [crmProvider, setCrmProvider] = useState<string>('ghl')
  // primaryCrmProvider drives the ordering + "Recommended for your setup"
  // copy on this page. Defaults to 'native' if the schema hasn't been
  // migrated yet (the GET endpoint falls back to 'native' in that case).
  // installSource lets us tailor the copy further ("Recommended — you
  // installed from the GHL marketplace") on a fresh marketplace install.
  const [primaryCrm, setPrimaryCrm] = useState<string>('native')
  const [installSource, setInstallSource] = useState<string | null>(null)
  // Show alternative CRMs (the two that aren't the workspace primary)
  // only when the user opts in. Default is "primary first, others tucked
  // behind one click" — that's the marketplace-aware UX: someone who
  // installed via the GHL marketplace shouldn't see Native + HubSpot
  // unsolicited.
  const [showAllCrms, setShowAllCrms] = useState(false)
  const [switchingCrm, setSwitchingCrm] = useState(false)
  const [loading, setLoading] = useState(true)

  // GHL disconnect — separate banner from Meta's so they don't clobber
  // each other if both happen in the same session.
  const [disconnectingGhl, setDisconnectingGhl] = useState(false)

  // Shopify — workspace-scoped (one shop per workspace, MVP). The input
  // field is needed because Shopify's authorize URL is shop-specific
  // (`https://{shop}/admin/oauth/authorize`), so we can't render a
  // static link the way GHL does — we have to ask which store first.
  const [shopifyConnection, setShopifyConnection] = useState<{ shop: string; scope: string; installedAt: string } | null>(null)
  const [shopifyBanner, setShopifyBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [shopDomainInput, setShopDomainInput] = useState('')
  const [disconnectingShopify, setDisconnectingShopify] = useState(false)

  function connectShopify() {
    // Normalise: strip protocol/path/whitespace; accept bare "myshop" by
    // appending .myshopify.com so the user doesn't have to type the
    // full domain. The install route does its own strict regex check —
    // this is just UX, not security.
    let shop = shopDomainInput.trim().toLowerCase()
    shop = shop.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (shop && !shop.includes('.')) shop = `${shop}.myshopify.com`
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      setShopifyBanner({ kind: 'error', text: 'Enter a valid Shopify domain like "yourstore.myshopify.com"' })
      return
    }
    window.location.href = `/api/auth/shopify/install?shop=${encodeURIComponent(shop)}&workspaceId=${workspaceId}`
  }

  async function disconnectShopify() {
    const confirmed = window.confirm(
      'Disconnect Shopify from this workspace?\n\nAgents will lose inventory awareness, customer history, and order context until you reconnect. Your data on Shopify is untouched — this only pauses our access.',
    )
    if (!confirmed) return
    setDisconnectingShopify(true)
    setShopifyBanner(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/shopify`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      setShopifyConnection(null)
      setShopifyBanner({ kind: 'success', text: 'Shopify disconnected. You can reconnect anytime.' })
    } catch (err: any) {
      setShopifyBanner({ kind: 'error', text: `Disconnect failed: ${err.message}` })
    } finally {
      setDisconnectingShopify(false)
    }
  }
  const [ghlBanner, setGhlBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function disconnectGhl() {
    const confirmed = window.confirm(
      'Disconnect HighLevel from this workspace?\n\nYour agents will pause until you reconnect — incoming SMS, email, FB and IG messages will not get a reply. Reconnecting later restores them automatically; agents and history are not deleted.',
    )
    if (!confirmed) return
    setDisconnectingGhl(true)
    setGhlBanner(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/integrations`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      // Optimistic local update — the GET would say the same thing on
      // next refresh, but updating now keeps the page responsive.
      setGhlConnected(false)
      setCrmProvider('native')
      setGhlBanner({ kind: 'success', text: 'HighLevel disconnected. You can reconnect anytime to resume.' })
    } catch (err: any) {
      setGhlBanner({ kind: 'error', text: `Disconnect failed: ${err.message}` })
    } finally {
      setDisconnectingGhl(false)
    }
  }

  // Twilio form
  const [showTwilioForm, setShowTwilioForm] = useState(false)
  const [twilioForm, setTwilioForm] = useState({ accountSid: '', authToken: '', phoneNumber: '' })
  const [savingTwilio, setSavingTwilio] = useState(false)

  // Calendly form
  const [showCalendlyForm, setShowCalendlyForm] = useState(false)
  const [calendlyToken, setCalendlyToken] = useState('')
  const [savingCalendly, setSavingCalendly] = useState(false)
  const [calendlyError, setCalendlyError] = useState('')

  // Cal.com form
  const [showCalcomForm, setShowCalcomForm] = useState(false)
  const [calcomKey, setCalcomKey] = useState('')
  const [savingCalcom, setSavingCalcom] = useState(false)
  const [calcomError, setCalcomError] = useState('')

  // Stripe form
  const [showStripeForm, setShowStripeForm] = useState(false)
  const [stripeKey, setStripeKey] = useState('')
  const [savingStripe, setSavingStripe] = useState(false)
  const [stripeError, setStripeError] = useState('')

  // Ad accounts (Meta Ads + Google Ads). These live in their own tables
  // (MetaAdAccount / GoogleAdAccount) rather than the generic Integration
  // table — they need account-level toggles (isActive, autoPilotEnabled)
  // that the Integration shape doesn't model.
  const [metaAdAccounts, setMetaAdAccounts] = useState<MetaAdAccountRow[]>([])
  const [googleAdAccounts, setGoogleAdAccounts] = useState<GoogleAdAccountRow[]>([])
  const [metaAdsBanner, setMetaAdsBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [googleAdsBanner, setGoogleAdsBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [busyAdAccount, setBusyAdAccount] = useState<string | null>(null)
  // Count of distinct agents in this workspace that have at least one
  // 'broken' reference (from the hourly health check). Drives the
  // "N agents have broken references" banner at the top — a one-stop
  // signal that a connected CRM lost a calendar or workflow an agent
  // was relying on. Click-through goes to /agents so the operator can
  // see which agents and drill into their tools page.
  const [brokenRefAgentCount, setBrokenRefAgentCount] = useState(0)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/integrations`)
      .then(r => r.json())
      .then(({ integrations: ints, ghlConnected: ghl, vapiActive: vapi, crmProvider: crm, shopify, primaryCrmProvider, installSource: src, brokenRefAgentCount: brokenCount }: {
        integrations: Integration[]
        ghlConnected: boolean
        vapiActive: boolean
        crmProvider: string
        shopify: { shop: string; scope: string; installedAt: string } | null
        primaryCrmProvider?: string
        installSource?: string | null
        brokenRefAgentCount?: number
      }) => {
        setIntegrations(ints || [])
        setGhlConnected(ghl)
        setVapiActive(vapi)
        setCrmProvider(crm || 'ghl')
        setShopifyConnection(shopify ?? null)
        if (primaryCrmProvider) setPrimaryCrm(primaryCrmProvider)
        setInstallSource(src ?? null)
        setBrokenRefAgentCount(brokenCount ?? 0)
      })
      .finally(() => setLoading(false))

    // Load ad accounts in parallel — failures here don't block the rest
    // of the page (workspace may not have any ad accounts yet).
    fetch(`/api/workspaces/${workspaceId}/ad-accounts`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: { meta: MetaAdAccountRow[]; google: GoogleAdAccountRow[] }) => {
        setMetaAdAccounts(data.meta || [])
        setGoogleAdAccounts(data.google || [])
      })
      .catch(err => console.warn('[integrations] ad-accounts load failed:', err))
  }, [workspaceId])

  // Read the Meta OAuth callback redirect query params once on mount and
  // strip them from the URL so a refresh doesn't re-show the banner.
  useEffect(() => {
    const meta = search.get('meta')
    if (!meta) return
    if (meta === 'connected') {
      const n = search.get('pages')
      const count = n ? parseInt(n, 10) : 0
      setMetaBanner({
        kind: 'success',
        text: count > 0
          ? `Connected ${count} Page${count === 1 ? '' : 's'} from Meta. Inbound DMs will route to the matching agent.`
          : 'Meta connected.',
      })
    } else if (meta === 'error') {
      const reason = search.get('reason') ?? 'unknown'
      const detail = search.get('detail')
      const pretty = humaniseMetaError(reason)
      setMetaBanner({
        kind: 'error',
        text: detail ? `${pretty} (${detail})` : pretty,
      })
    }
    // Strip the params so reloads don't re-show the banner.
    const url = new URL(window.location.href)
    url.searchParams.delete('meta')
    url.searchParams.delete('pages')
    url.searchParams.delete('reason')
    url.searchParams.delete('detail')
    window.history.replaceState({}, '', url.toString())
  }, [search])

  // Shopify OAuth callback redirect — same shape as Meta. The callback
  // already sets `shopify=connected&shop=<domain>` on success or
  // `shopify=error&reason=<reason>` on failure. We re-fetch the
  // integrations endpoint on success so the connected card replaces
  // the input form without requiring a refresh.
  useEffect(() => {
    const s = search.get('shopify')
    if (!s) return
    if (s === 'connected') {
      const shop = search.get('shop') ?? ''
      setShopifyBanner({
        kind: 'success',
        text: shop
          ? `Connected to ${shop}. Agents can now see inventory, orders, and customer history.`
          : 'Shopify connected.',
      })
      // Re-pull the connection record so the connected-state card renders.
      fetch(`/api/workspaces/${workspaceId}/integrations`)
        .then(r => r.json())
        .then(({ shopify }: { shopify: { shop: string; scope: string; installedAt: string } | null }) => {
          setShopifyConnection(shopify ?? null)
        })
        .catch(() => { /* banner already shows success — silent on refetch fail */ })
    } else if (s === 'error') {
      const reason = search.get('reason') ?? 'unknown'
      const pretty = humaniseShopifyError(reason)
      setShopifyBanner({ kind: 'error', text: pretty })
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('shopify')
    url.searchParams.delete('shop')
    url.searchParams.delete('reason')
    window.history.replaceState({}, '', url.toString())
  }, [search, workspaceId])

  // Same pattern for the Meta Ads + Google Ads OAuth callbacks. Each
  // callback redirects with its own marker param so we can distinguish
  // success/failure and surface a tailored banner. We also re-fetch the
  // ad-account list on success so the new rows show up immediately.
  useEffect(() => {
    const m = search.get('meta_ads')
    const g = search.get('google_ads')
    if (!m && !g) return

    function pretty(provider: string, reason: string): string {
      switch (reason) {
        case 'no_ad_accounts': return `No ${provider} ad accounts on the authorising user. Confirm "Manage campaigns" task is granted in Business Settings.`
        case 'no_customers': return `The Google account doesn't have access to any Google Ads customers.`
        case 'invalid_state': return `OAuth state was invalid or expired. Try connecting again.`
        case 'token_exchange_failed': return `${provider} rejected the OAuth code. Check your client credentials and developer token.`
        case 'server_misconfigured': return `${provider} integration env vars are missing on this deployment.`
        case 'missing_code_or_state': return `OAuth callback was missing required parameters.`
        case 'access_denied': return `Authorisation was declined.`
        default: return `${provider} connection failed (${reason}).`
      }
    }

    if (m === 'connected') {
      const c = parseInt(search.get('connected') ?? '0', 10) || 0
      const u = parseInt(search.get('updated') ?? '0', 10) || 0
      const bits: string[] = []
      if (c > 0) bits.push(`${c} new`)
      if (u > 0) bits.push(`${u} reconnected`)
      setMetaAdsBanner({
        kind: 'success',
        text: bits.length
          ? `Meta Ads — ${bits.join(', ')} ad ${(c + u) === 1 ? 'account' : 'accounts'}.`
          : 'Meta Ads connected.',
      })
      // Refetch so the new rows appear without a manual reload.
      fetch(`/api/workspaces/${workspaceId}/ad-accounts`)
        .then(r => r.json())
        .then((data: { meta: MetaAdAccountRow[]; google: GoogleAdAccountRow[] }) => {
          setMetaAdAccounts(data.meta || [])
          setGoogleAdAccounts(data.google || [])
        })
        .catch(() => {})
    } else if (m === 'error') {
      const reason = search.get('reason') ?? 'unknown'
      const detail = search.get('detail')
      setMetaAdsBanner({ kind: 'error', text: detail ? `${pretty('Meta Ads', reason)} (${detail})` : pretty('Meta Ads', reason) })
    }

    if (g === 'connected') {
      const c = parseInt(search.get('connected') ?? '0', 10) || 0
      const u = parseInt(search.get('updated') ?? '0', 10) || 0
      const bits: string[] = []
      if (c > 0) bits.push(`${c} new`)
      if (u > 0) bits.push(`${u} reconnected`)
      setGoogleAdsBanner({
        kind: 'success',
        text: bits.length
          ? `Google Ads — ${bits.join(', ')} ${(c + u) === 1 ? 'customer' : 'customers'}.`
          : 'Google Ads connected.',
      })
      fetch(`/api/workspaces/${workspaceId}/ad-accounts`)
        .then(r => r.json())
        .then((data: { meta: MetaAdAccountRow[]; google: GoogleAdAccountRow[] }) => {
          setMetaAdAccounts(data.meta || [])
          setGoogleAdAccounts(data.google || [])
        })
        .catch(() => {})
    } else if (g === 'error') {
      const reason = search.get('reason') ?? 'unknown'
      const detail = search.get('detail')
      setGoogleAdsBanner({ kind: 'error', text: detail ? `${pretty('Google Ads', reason)} (${detail})` : pretty('Google Ads', reason) })
    }

    const url = new URL(window.location.href)
    url.searchParams.delete('meta_ads')
    url.searchParams.delete('google_ads')
    url.searchParams.delete('connected')
    url.searchParams.delete('updated')
    url.searchParams.delete('reason')
    url.searchParams.delete('detail')
    window.history.replaceState({}, '', url.toString())
  }, [search, workspaceId])

  async function disconnectAdAccount(provider: 'meta' | 'google', id: string, name: string) {
    if (!confirm(`Disconnect "${name}"? Drafts, recommendations, and historical metrics for this account will be deleted.`)) return
    setBusyAdAccount(id)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-accounts/${provider}/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      if (provider === 'meta') setMetaAdAccounts(prev => prev.filter(a => a.id !== id))
      else setGoogleAdAccounts(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Disconnect failed'
      if (provider === 'meta') setMetaAdsBanner({ kind: 'error', text: msg })
      else setGoogleAdsBanner({ kind: 'error', text: msg })
    } finally {
      setBusyAdAccount(null)
    }
  }

  async function toggleAdAccount(
    provider: 'meta' | 'google',
    id: string,
    field: 'isActive' | 'autoPilotEnabled',
    next: boolean,
  ) {
    setBusyAdAccount(id)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/ad-accounts/${provider}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
      const { account } = await r.json()
      if (provider === 'meta') {
        setMetaAdAccounts(prev => prev.map(a => a.id === id ? { ...a, ...account } : a))
      } else {
        setGoogleAdAccounts(prev => prev.map(a => a.id === id ? { ...a, ...account } : a))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed'
      if (provider === 'meta') setMetaAdsBanner({ kind: 'error', text: msg })
      else setGoogleAdsBanner({ kind: 'error', text: msg })
    } finally {
      setBusyAdAccount(null)
    }
  }

  function formatGoogleCustomerId(id: string): string {
    return /^\d{10}$/.test(id) ? `${id.slice(0,3)}-${id.slice(3,6)}-${id.slice(6)}` : id
  }

  async function connectTwilio(e: React.FormEvent) {
    e.preventDefault()
    setSavingTwilio(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'twilio',
          name: `Twilio ${twilioForm.phoneNumber}`,
          credentials: { accountSid: twilioForm.accountSid, authToken: twilioForm.authToken },
          config: { phoneNumber: twilioForm.phoneNumber },
        }),
      })
      // Without this guard, a non-2xx response (validation error,
      // plan limit, server bug) would push an `undefined` integration
      // into the list and crash on the next .map(i => i.id).
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't save Twilio (${res.status})`)
      }
      const { integration } = await res.json()
      if (!integration) throw new Error('Server returned no integration record.')
      setIntegrations(prev => [...prev, integration])
      setShowTwilioForm(false)
      setTwilioForm({ accountSid: '', authToken: '', phoneNumber: '' })
    } catch (err: any) {
      console.error('[integrations] connectTwilio failed', err)
      alert(err?.message ?? 'Could not save Twilio. Check your credentials and try again.')
    } finally {
      setSavingTwilio(false)
    }
  }

  async function connectCalendly(e: React.FormEvent) {
    e.preventDefault()
    if (!calendlyToken.trim()) return
    setSavingCalendly(true)
    setCalendlyError('')
    try {
      // Verify the token works
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'calendly', token: calendlyToken.trim() }),
      })
      const verifyData = await verify.json()
      if (!verify.ok || verifyData.error) throw new Error(verifyData.error || 'Invalid token')

      const res = await fetch(`/api/workspaces/${workspaceId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'calendly',
          name: `Calendly (${verifyData.userName || 'connected'})`,
          credentials: { accessToken: calendlyToken.trim() },
          config: { userUri: verifyData.userUri },
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't save Calendly (${res.status})`)
      }
      const { integration } = await res.json()
      if (!integration) throw new Error('Server returned no integration record.')
      setIntegrations(prev => [...prev, integration])
      setShowCalendlyForm(false)
      setCalendlyToken('')
    } catch (err: any) { setCalendlyError(err.message) }
    finally { setSavingCalendly(false) }
  }

  async function connectCalcom(e: React.FormEvent) {
    e.preventDefault()
    if (!calcomKey.trim()) return
    setSavingCalcom(true)
    setCalcomError('')
    try {
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'calcom', token: calcomKey.trim() }),
      })
      const verifyData = await verify.json()
      if (!verify.ok || verifyData.error) throw new Error(verifyData.error || 'Invalid API key')

      const res = await fetch(`/api/workspaces/${workspaceId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'calcom',
          name: `Cal.com (${verifyData.userName || 'connected'})`,
          credentials: { apiKey: calcomKey.trim() },
          config: { userId: verifyData.userId },
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't save Cal.com (${res.status})`)
      }
      const { integration } = await res.json()
      if (!integration) throw new Error('Server returned no integration record.')
      setIntegrations(prev => [...prev, integration])
      setShowCalcomForm(false)
      setCalcomKey('')
    } catch (err: any) { setCalcomError(err.message) }
    finally { setSavingCalcom(false) }
  }

  async function connectStripe(e: React.FormEvent) {
    e.preventDefault()
    if (!stripeKey.trim()) return
    setSavingStripe(true)
    setStripeError('')
    try {
      const verify = await fetch('/api/integrations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'stripe', token: stripeKey.trim() }),
      })
      const verifyData = await verify.json()
      if (!verify.ok || verifyData.error) throw new Error(verifyData.error || 'Invalid key')

      const res = await fetch(`/api/workspaces/${workspaceId}/integrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'stripe',
          name: `Stripe (${verifyData.accountName || 'connected'})`,
          credentials: { secretKey: stripeKey.trim() },
          config: { accountId: verifyData.accountId },
        }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't save Stripe (${res.status})`)
      }
      const { integration } = await res.json()
      if (!integration) throw new Error('Server returned no integration record.')
      setIntegrations(prev => [...prev, integration])
      setShowStripeForm(false)
      setStripeKey('')
    } catch (err: any) { setStripeError(err.message) }
    finally { setSavingStripe(false) }
  }

  async function switchCrmProvider(provider: string) {
    setSwitchingCrm(true)
    // Flipping to 'native' requires an extra step — there's no OAuth flow,
    // but we do need a placeholder Location row keyed `native:<wsId>` so
    // Agent.locationId can resolve through the factory. The provision
    // route is idempotent so it's safe to call every time.
    if (provider === 'native') {
      await fetch(`/api/workspaces/${workspaceId}/crm/native/provision`, { method: 'POST' })
    }
    await fetch(`/api/workspaces/${workspaceId}/integrations`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crmProvider: provider }),
    })
    setCrmProvider(provider)
    setSwitchingCrm(false)
    // Sidebar reads workspace.locations to decide whether to show the
    // Native CRM nav section, so a hard reload is the cleanest way to
    // make the new menu items appear after switching.
    if (provider === 'native') {
      window.location.reload()
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-zinc-500 text-sm">Loading…</p></div>

  function humaniseMetaError(reason: string): string {
    switch (reason) {
      case 'no_pages': return "The Facebook account you authorized doesn't manage any Pages. Connect from a Facebook account that admins at least one Page."
      case 'invalid_state': return 'OAuth state was invalid or expired. Try connecting again.'
      case 'token_exchange_failed': return 'Meta rejected the OAuth code. Re-check META_APP_ID and META_APP_SECRET in Vercel and redeploy.'
      case 'server_misconfigured': return 'Meta is not configured on this deployment (missing env vars). See docs/meta-integration.md.'
      case 'missing_code_or_state': return 'OAuth callback was missing required parameters.'
      case 'access_denied': return 'You declined access on the Facebook prompt.'
      default: return `Meta connection failed (${reason}).`
    }
  }

  function humaniseShopifyError(reason: string): string {
    switch (reason) {
      case 'cancelled': return 'You cancelled the Shopify install. Try again when ready.'
      case 'bad_shop': return 'The shop domain was invalid. Use the format "yourstore.myshopify.com".'
      case 'bad_state': return 'OAuth state was invalid or expired. Start the connection again from this page.'
      case 'bad_hmac': return "We couldn't verify the response came from Shopify. Try again — if this keeps happening, check the app's redirect URL in the Shopify Partner dashboard."
      case 'missing_code': return 'Shopify did not return an authorization code. Try again.'
      case 'not_configured': return 'Shopify is not configured on this deployment (SHOPIFY_API_KEY / SHOPIFY_API_SECRET missing).'
      case 'token_exchange_failed': return 'Shopify rejected the OAuth code. Re-check SHOPIFY_API_KEY and SHOPIFY_API_SECRET in Vercel and redeploy.'
      case 'token_exchange_threw': return 'Network error while contacting Shopify. Try again.'
      case 'no_token': return 'Shopify completed auth but returned no access token. Try again.'
      case 'non_expiring_token': return 'Your Shopify app is configured for legacy non-expiring tokens, which Shopify\'s API no longer accepts. Switch the app to expiring offline tokens in your Shopify Dev Dashboard, release a new version, then reconnect.'
      case 'save_failed': return 'Auth succeeded but we failed to persist the token. Check server logs and try again.'
      case 'oauth_error': return 'Shopify reported an OAuth error. Try again.'
      default: return `Shopify connection failed (${reason}).`
    }
  }

  const twilioIntegrations = integrations.filter(i => i.type === 'twilio')
  const metaIntegrations = integrations.filter(i => i.type === 'meta' && i.isActive)
  const inactiveMetaIntegrations = integrations.filter(i => i.type === 'meta' && !i.isActive)
  const hubspotIntegrations = integrations.filter(i => i.type === 'hubspot')
  const calendlyIntegrations = integrations.filter(i => i.type === 'calendly')
  const calcomIntegrations = integrations.filter(i => i.type === 'calcom')
  const stripeIntegrations = integrations.filter(i => i.type === 'stripe')

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Integrations</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          {embedded
            ? 'These extras run on top of LeadConnector. Channels, calendars, and contacts are managed in your CRM.'
            : 'Connect your CRM, telephony, and communication platforms. Agents work across all connected channels.'}
        </p>
      </div>

      <ConnectivityCheckPanel
        workspaceId={workspaceId}
        brokenRefAgentCount={brokenRefAgentCount}
        onRefresh={() => {
          // After a manual check, the agent-list view will reflect any
          // newly-broken / newly-fixed refs; surface the same count via
          // the integrations API to keep this banner in sync.
          fetch(`/api/workspaces/${workspaceId}/integrations`, { cache: 'no-store' })
            .then(r => r.json())
            .then(d => {
              if (typeof d?.brokenRefAgentCount === 'number') {
                setBrokenRefAgentCount(d.brokenRefAgentCount)
              }
            })
            .catch(() => {})
        }}
      />



      {metaBanner && (
        <div
          className="rounded-xl border p-4 mb-6 flex items-start justify-between gap-3"
          style={
            metaBanner.kind === 'success'
              ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
              : { borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }
          }
          role="status"
        >
          <p className="text-sm font-medium">{metaBanner.text}</p>
          <button
            onClick={() => setMetaBanner(null)}
            className="text-xs opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {/* CRM Provider Selector — only show when both are available
          AND we're not embedded inside GHL (in embed mode, the CRM is
          implicitly LeadConnector and the choice doesn't make sense). */}
      {!embedded && ghlConnected && hubspotIntegrations.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 mb-6">
          <p className="text-sm font-medium text-zinc-200 mb-1">Primary CRM</p>
          <p className="text-xs text-zinc-500 mb-3">Choose which CRM your agents use for contacts, deals, messaging, and calendar.</p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'ghl', label: 'LeadConnector', icon: LeadConnectorIcon, color: '' },
              { value: 'hubspot', label: 'HubSpot', icon: HubSpotIcon, color: 'text-[#FF7A59]' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={switchingCrm}
                onClick={() => switchCrmProvider(opt.value)}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  crmProvider === opt.value
                    ? 'bg-zinc-900'
                    : 'border-zinc-800 hover:border-zinc-600'
                }`}
                style={crmProvider === opt.value ? { borderColor: 'var(--accent-primary)' } : undefined}
              >
                <div className={`w-6 h-6 flex-shrink-0 ${opt.color}`}>
                  <opt.icon className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-sm font-medium text-zinc-200">{opt.label}</span>
                  {crmProvider === opt.value && (
                    <span className="ml-2 text-xs text-emerald-400">Active</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">

        {/* ─── CRM cards ─────────────────────────────────────────────────
            Primary CRM card always renders; the two alternatives sit
            behind a "Use a different CRM" toggle (showAllCrms). Drives
            the "no neutral menu of options" UX for marketplace installs
            — someone arriving from the GHL marketplace shouldn't see
            Native + HubSpot unsolicited. */}

        {/* Native CRM — built-in. Shown when primary, or after the user
            explicitly opens the alternatives panel. Hidden entirely in
            embed mode (GHL is the CRM, Native is irrelevant). */}
        {!embedded && (primaryCrm === 'native' || showAllCrms) && (
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {primaryCrm === 'native' && (
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--accent-primary)' }}>
              {installSource === 'direct' || installSource === null
                ? 'Recommended for your setup'
                : 'Workspace default'}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-base"
                style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
              >
                📇
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Native CRM</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Built-in contacts, lists, suppression, SMS &amp; email — no external CRM required.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {crmProvider === 'native' ? (
                <span
                  className="text-xs px-2.5 py-1 rounded-full font-semibold"
                  style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                >
                  Active
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => switchCrmProvider('native')}
                  disabled={switchingCrm}
                  className="text-xs font-semibold px-3 h-8 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                >
                  {switchingCrm ? 'Switching…' : 'Switch to Native'}
                </button>
              )}
            </div>
          </div>
          {crmProvider === 'native' && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <a href={`/dashboard/${workspaceId}/contacts`} className="text-xs px-3 py-2 rounded-md text-center transition-opacity hover:opacity-80" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}>Contacts →</a>
              <a href={`/dashboard/${workspaceId}/lists`} className="text-xs px-3 py-2 rounded-md text-center transition-opacity hover:opacity-80" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}>Lists →</a>
              <a href={`/dashboard/${workspaceId}/imports`} className="text-xs px-3 py-2 rounded-md text-center transition-opacity hover:opacity-80" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}>Import CSV →</a>
              <a href={`/dashboard/${workspaceId}/suppressions`} className="text-xs px-3 py-2 rounded-md text-center transition-opacity hover:opacity-80" style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}>Suppressions →</a>
            </div>
          )}
        </div>
        )}

        {/* LeadConnector (GHL) — always rendered in embed mode (the
            CRM is implicit and locked); standalone mode keeps the
            primary/showAll logic. */}
        {(embedded || primaryCrm === 'ghl' || showAllCrms) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          {embedded ? (
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--accent-primary)' }}>
              Connected via marketplace
            </p>
          ) : primaryCrm === 'ghl' ? (
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--accent-primary)' }}>
              {installSource === 'ghl_marketplace'
                ? 'Recommended — you installed from the GHL marketplace'
                : 'Recommended for your setup'}
            </p>
          ) : null}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"><LeadConnectorIcon className="w-8 h-8" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">LeadConnector</p>
                <p className="text-xs text-zinc-500">CRM, pipelines, SMS, email, calendars</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ghlConnected && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
              )}
              {/* Reconnect + Disconnect are hidden in embed mode.
                  The user can't disconnect from inside the iframe
                  because the iframe session is bound to this exact
                  Location — disconnect would lock them out. */}
              {!embedded && (
                <a
                  href={`/api/auth/crm/connect?workspaceId=${workspaceId}`}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  {ghlConnected ? 'Reconnect' : 'Connect'}
                </a>
              )}
              {!embedded && ghlConnected && (
                <button
                  type="button"
                  onClick={disconnectGhl}
                  disabled={disconnectingGhl}
                  className="text-xs px-3 py-1.5 rounded-lg border border-rose-900/60 text-rose-300 hover:border-rose-700 hover:text-rose-200 transition-colors disabled:opacity-50"
                >
                  {disconnectingGhl ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </div>
          </div>
          {ghlBanner && (
            <p className={`text-xs mt-3 ${ghlBanner.kind === 'success' ? 'text-emerald-500/80' : 'text-rose-400'}`}>
              {ghlBanner.text}
            </p>
          )}
          {ghlConnected && crmProvider === 'ghl' && hubspotIntegrations.length > 0 && (
            <p className="text-xs text-emerald-500/70 mt-3">
              LeadConnector is your primary CRM — agents use it for contacts, deals, and messaging.
            </p>
          )}
          {ghlConnected && !(crmProvider === 'ghl' && hubspotIntegrations.length > 0) && (
            <p className="text-xs text-zinc-600 mt-3">
              Reconnect to refresh your token or add new permission scopes.
            </p>
          )}
        </div>
        )}

        {/* HubSpot — hidden entirely in embed mode (the user has GHL,
            HubSpot isn't a meaningful choice). Otherwise rendered when
            primary or after the user expands "Use a different CRM". */}
        {!embedded && (primaryCrm === 'hubspot' || showAllCrms) && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          {primaryCrm === 'hubspot' && (
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--accent-primary)' }}>
              {installSource === 'hubspot_marketplace'
                ? 'Recommended — you installed from HubSpot'
                : 'Recommended for your setup'}
            </p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[#FF7A59]"><HubSpotIcon className="w-7 h-7" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">HubSpot</p>
                <p className="text-xs text-zinc-500">CRM contacts, deals, timeline events</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {hubspotIntegrations.length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
              )}
              {hubspotIntegrations.length > 0 && crmProvider !== 'hubspot' && (
                <button
                  onClick={() => switchCrmProvider('hubspot')}
                  disabled={switchingCrm}
                  className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors disabled:opacity-50"
                >
                  Use as primary
                </button>
              )}
              <a
                href={`/api/auth/hubspot?workspaceId=${workspaceId}`}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                {hubspotIntegrations.length > 0 ? 'Reconnect' : 'Connect'}
              </a>
            </div>
          </div>
          {hubspotIntegrations.length > 0 && crmProvider === 'hubspot' && (
            <p className="text-xs text-emerald-500/70 mt-3">
              HubSpot is your primary CRM — agents use it for contacts, deals, and messaging.
            </p>
          )}
        </div>
        )}

        {/* "Use a different CRM" toggle — hidden in embed mode (the
            CRM is locked to LeadConnector) and otherwise only shown
            when there are alternatives to reveal. */}
        {!embedded && !showAllCrms && (
          <button
            type="button"
            onClick={() => setShowAllCrms(true)}
            className="w-full text-xs py-2 rounded-lg border border-dashed transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
          >
            Use a different CRM →
          </button>
        )}

        {/* Shopify */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-base font-semibold"
                style={{ background: '#95BF47', color: '#fff' }}
                aria-label="Shopify"
              >S</div>
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Shopify <NewBadge since="2026-05-12" className="ml-1" />
                </p>
                <p className="text-xs text-zinc-500">Inventory, orders, customers — agents stay context- and stock-aware</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {shopifyConnection && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
              )}
              {shopifyConnection && (
                <button
                  type="button"
                  onClick={disconnectShopify}
                  disabled={disconnectingShopify}
                  className="text-xs px-3 py-1.5 rounded-lg border border-rose-900/60 text-rose-300 hover:border-rose-700 hover:text-rose-200 transition-colors disabled:opacity-50"
                >
                  {disconnectingShopify ? 'Disconnecting…' : 'Disconnect'}
                </button>
              )}
            </div>
          </div>

          {shopifyConnection ? (
            <p className="text-xs text-emerald-500/80 mt-3">
              Connected to <span className="font-mono">{shopifyConnection.shop}</span>. Agents can now look up inventory, recent orders, and customer history when handling DMs.
            </p>
          ) : (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={shopDomainInput}
                onChange={e => setShopDomainInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') connectShopify() }}
                placeholder="yourstore.myshopify.com"
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                aria-label="Shopify shop domain"
              />
              <button
                type="button"
                onClick={connectShopify}
                className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
              >
                Connect
              </button>
            </div>
          )}

          {shopifyBanner && (
            <p className={`text-xs mt-3 ${shopifyBanner.kind === 'success' ? 'text-emerald-500/80' : 'text-rose-400'}`}>
              {shopifyBanner.text}
            </p>
          )}
        </div>

        {/* Vapi Voice */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0"><VapiIcon className="w-8 h-8" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Voice AI (Vapi)</p>
                <p className="text-xs text-zinc-500">Inbound call handling — configure per agent in the Voice tab</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${vapiActive ? 'bg-emerald-900/30 text-emerald-400' : 'bg-amber-900/30 text-amber-400'}`}>
              {vapiActive ? 'Active' : 'Not configured'}
            </span>
          </div>
          {!vapiActive && (
            <div className="mt-4 rounded-lg bg-zinc-900 border border-zinc-800 p-4 space-y-2">
              <p className="text-xs text-zinc-300 font-medium">Setup required</p>
              <p className="text-xs text-zinc-500">Add these environment variables in your Vercel project settings:</p>
              <div className="space-y-1 font-mono">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400 bg-zinc-800 px-2 py-1 rounded">VAPI_API_KEY</span>
                  <span className="text-zinc-600">— your Vapi secret key</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400 bg-zinc-800 px-2 py-1 rounded">VAPI_PUBLIC_KEY</span>
                  <span className="text-zinc-600">— your Vapi public key (for test calls)</span>
                </div>
              </div>
              <p className="text-xs text-zinc-600">
                Get your keys at{' '}
                <a href="https://dashboard.vapi.ai" target="_blank" rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300">
                  dashboard.vapi.ai
                </a>
                {' '}→ Account → API Keys. Redeploy after adding.
              </p>
            </div>
          )}
        </div>

        {/* Twilio — hidden in embed mode (GHL connects SMS via its
            own Twilio integration; Voxility-direct Twilio would be
            duplicative). */}
        {!embedded && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[#F22F46]"><TwilioIcon className="w-7 h-7" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Twilio</p>
                <p className="text-xs text-zinc-500">Direct SMS — no CRM required</p>
              </div>
            </div>
            <button
              onClick={() => setShowTwilioForm(!showTwilioForm)}
              className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
            >
              + Add number
            </button>
          </div>

          {twilioIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {twilioIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}

          {showTwilioForm && (
            <form onSubmit={connectTwilio} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Find these in your <a href="https://console.twilio.com" target="_blank" className="text-blue-400 hover:underline">Twilio Console</a>.</p>
              <input
                type="text"
                value={twilioForm.accountSid}
                onChange={e => setTwilioForm(p => ({ ...p, accountSid: e.target.value }))}
                placeholder="Account SID (ACxxxxxxxx)"
                required
                className="w-full border rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
              />
              <input
                type="password"
                value={twilioForm.authToken}
                onChange={e => setTwilioForm(p => ({ ...p, authToken: e.target.value }))}
                placeholder="Auth Token"
                required
                className="w-full border rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
              />
              <input
                type="text"
                value={twilioForm.phoneNumber}
                onChange={e => setTwilioForm(p => ({ ...p, phoneNumber: e.target.value }))}
                placeholder="Phone number (e.g. +15551234567)"
                required
                className="w-full border rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
              />
              <div className="flex gap-2">
                <button type="submit" disabled={savingTwilio} className="flex-1 rounded-lg font-medium text-sm h-9 transition-colors disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
                  {savingTwilio ? 'Connecting…' : 'Connect Twilio'}
                </button>
                <button type="button" onClick={() => setShowTwilioForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
        )}

        {/* Meta — Facebook Messenger + Instagram DMs (native, no CRM dep).
            Hidden in embed mode: GHL connects Meta Pages + IG Business
            accounts via its own integration and pipes DMs into its
            conversation API — Voxility reads them from there. A
            second direct connection here would create two intake
            paths for the same message. */}
        {!embedded && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 relative">
                {/* Stack the two glyphs slightly so the pair reads as one
                    "Meta" affordance without inventing a custom icon. */}
                <div className="absolute -left-1 -top-0.5 text-[#1877F2]"><FacebookIcon className="w-5 h-5" /></div>
                <div className="absolute right-0 bottom-0"><InstagramIcon className="w-5 h-5" /></div>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Meta — Messenger &amp; Instagram</p>
                <p className="text-xs text-zinc-500">Direct DMs from Facebook Pages and Instagram Business accounts — no CRM required</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {metaIntegrations.length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">
                  {metaIntegrations.length} {metaIntegrations.length === 1 ? 'Page' : 'Pages'}
                </span>
              )}
              <a
                href={`/api/meta/oauth/connect?workspaceId=${workspaceId}`}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors"
              >
                {metaIntegrations.length > 0 ? '+ Add Page' : 'Connect Meta'}
              </a>
            </div>
          </div>

          {/* Connected pages — show Page name plus an IG badge when the
              Page is also linked to an Instagram Business Account. */}
          {metaIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {metaIntegrations.map(i => {
                const cred = (i as Integration & { credentials?: { pageName?: string; instagramBusinessAccountId?: string } }).credentials
                const igLinked = !!cred?.instagramBusinessAccountId
                return (
                  <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-zinc-300 truncate">{cred?.pageName || i.name}</span>
                      {igLinked && (
                        <span className="text-[10px] uppercase tracking-wider text-pink-400/80 flex-shrink-0">+ IG</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-emerald-400">Active</span>
                      <button
                        type="button"
                        onClick={() => disconnectMetaPage(i.id)}
                        disabled={disconnectingMeta === i.id}
                        className="text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Disconnect this Page"
                        aria-label={`Disconnect ${cred?.pageName || i.name}`}
                      >
                        {disconnectingMeta === i.id ? '…' : 'Disconnect'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Inactive integrations need a clear "reconnect" CTA — Meta
              page tokens can't refresh silently, so once one expires
              the operator has to redo OAuth. */}
          {inactiveMetaIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {inactiveMetaIntegrations.map(i => (
                <div
                  key={i.id}
                  className="flex items-center justify-between border rounded-lg px-3 py-2"
                  style={{ background: 'var(--accent-amber-bg)', borderColor: 'var(--accent-amber)' }}
                >
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--accent-amber)' }}>{i.name}</span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs font-semibold" style={{ color: 'var(--accent-amber)' }}>Token expired — reconnect</span>
                    <button
                      type="button"
                      onClick={() => disconnectMetaPage(i.id)}
                      disabled={disconnectingMeta === i.id}
                      className="text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Remove this integration"
                    >
                      {disconnectingMeta === i.id ? '…' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Operator-facing explainer that's only shown to workspaces
              without a CRM connected — those are the ones for whom this
              path matters most ("I don't want GoHighLevel just to talk
              to my FB DMs"). */}
          {!ghlConnected && hubspotIntegrations.length === 0 && metaIntegrations.length === 0 && (
            <p className="text-xs text-zinc-500 mt-3">
              Connect Meta directly to handle Messenger and Instagram DMs without setting up a CRM. Each Page you authorize becomes its own integration; route different Pages to different agents from the routing rules tab.
            </p>
          )}
        </div>
        )}

        {/* Calendars section — hidden entirely in embed mode (GHL has
            its own calendars; Calendly and Cal.com integrations would
            duplicate). */}
        {!embedded && (
        <>
        {/* ── Section: Calendars ── */}
        <div className="pt-4 pb-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Calendars</p>
        </div>

        {/* Calendly */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[#006BFF]"><CalendlyIcon className="w-7 h-7" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Calendly</p>
                <p className="text-xs text-zinc-500">Scheduling links, availability, and bookings</p>
              </div>
            </div>
            {calendlyIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <button onClick={() => { setShowCalendlyForm(!showCalendlyForm); setCalendlyError('') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors">
                Connect
              </button>
            )}
          </div>
          {calendlyIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {calendlyIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}
          {showCalendlyForm && (
            <form onSubmit={connectCalendly} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Create a Personal Access Token in <span className="text-blue-400">Calendly &gt; Integrations &gt; API</span>.</p>
              <input type="password" value={calendlyToken}
                onChange={e => setCalendlyToken(e.target.value)}
                placeholder="Personal Access Token"
                required
                className="w-full border rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }} />
              {calendlyError && <p className="text-xs text-red-400">{calendlyError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={savingCalendly} className="flex-1 rounded-lg font-medium text-sm h-9 transition-colors disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
                  {savingCalendly ? 'Verifying…' : 'Connect Calendly'}
                </button>
                <button type="button" onClick={() => setShowCalendlyForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>

        {/* Cal.com */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white"><CalcomIcon className="w-7 h-7" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Cal.com</p>
                <p className="text-xs text-zinc-500">Open-source scheduling — event types, availability, bookings</p>
              </div>
            </div>
            {calcomIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <button onClick={() => { setShowCalcomForm(!showCalcomForm); setCalcomError('') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors">
                Connect
              </button>
            )}
          </div>
          {calcomIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {calcomIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}
          {showCalcomForm && (
            <form onSubmit={connectCalcom} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Generate an API key in <span className="text-blue-400">Cal.com &gt; Settings &gt; Developer &gt; API Keys</span>.</p>
              <input type="password" value={calcomKey}
                onChange={e => setCalcomKey(e.target.value)}
                placeholder="API Key (cal_live_...)"
                required
                className="w-full border rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }} />
              {calcomError && <p className="text-xs text-red-400">{calcomError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={savingCalcom} className="flex-1 rounded-lg font-medium text-sm h-9 transition-colors disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
                  {savingCalcom ? 'Verifying…' : 'Connect Cal.com'}
                </button>
                <button type="button" onClick={() => setShowCalcomForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>
        </>
        )}

        {/* Payments section — hidden in embed mode (GHL handles
            payments natively; Voxility's Stripe integration would
            duplicate). */}
        {!embedded && (
        <>
        {/* ── Section: Payments ── */}
        <div className="pt-4 pb-1">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Payments</p>
        </div>

        {/* Stripe */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[#635BFF]"><StripeIcon className="w-7 h-7" /></div>
              <div>
                <p className="text-sm font-medium text-zinc-200">Stripe</p>
                <p className="text-xs text-zinc-500">Collect payments and send invoices during conversations</p>
              </div>
            </div>
            {stripeIntegrations.length > 0 ? (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-900/30 text-emerald-400">Connected</span>
            ) : (
              <button onClick={() => { setShowStripeForm(!showStripeForm); setStripeError('') }}
                className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors">
                Connect
              </button>
            )}
          </div>
          {stripeIntegrations.length > 0 && (
            <div className="space-y-1 mb-3">
              {stripeIntegrations.map(i => (
                <div key={i.id} className="flex items-center justify-between bg-zinc-900 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-300">{i.name}</span>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          )}
          {showStripeForm && (
            <form onSubmit={connectStripe} className="space-y-3 mt-3 pt-3 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">Find your secret key in <span className="text-blue-400">Stripe Dashboard &gt; Developers &gt; API keys</span>.</p>
              <input type="password" value={stripeKey}
                onChange={e => setStripeKey(e.target.value)}
                placeholder="Secret Key (sk_live_...)"
                required
                className="w-full border rounded-lg px-3 py-2 text-sm placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }} />
              {stripeError && <p className="text-xs text-red-400">{stripeError}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={savingStripe} className="flex-1 rounded-lg font-medium text-sm h-9 transition-colors disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
                  {savingStripe ? 'Verifying…' : 'Connect Stripe'}
                </button>
                <button type="button" onClick={() => setShowStripeForm(false)} className="px-4 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:border-zinc-500 transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>
        </>
        )}

        {/* ── Section: Advertising ── */}
        <div className="pt-4 pb-1">
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Advertising</p>
        </div>

        {/* Banners — separate from the Pages banner so they don't get
            swallowed when both fire on the same load. */}
        {metaAdsBanner && (
          <div
            className="rounded-xl border p-3 flex items-start justify-between gap-3"
            style={
              metaAdsBanner.kind === 'success'
                ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                : { borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }
            }
            role="status"
          >
            <p className="text-sm font-medium">{metaAdsBanner.text}</p>
            <button onClick={() => setMetaAdsBanner(null)} className="text-xs opacity-60 hover:opacity-100" aria-label="Dismiss">✕</button>
          </div>
        )}
        {googleAdsBanner && (
          <div
            className="rounded-xl border p-3 flex items-start justify-between gap-3"
            style={
              googleAdsBanner.kind === 'success'
                ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                : { borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }
            }
            role="status"
          >
            <p className="text-sm font-medium">{googleAdsBanner.text}</p>
            <button onClick={() => setGoogleAdsBanner(null)} className="text-xs opacity-60 hover:opacity-100" aria-label="Dismiss">✕</button>
          </div>
        )}

        {/* Meta Ads — campaigns + budgets + creatives via Marketing API */}
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-[#1877F2]"><FacebookIcon className="w-7 h-7" /></div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Meta Ads</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Create + manage Facebook and Instagram ad campaigns</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {metaAdAccounts.filter(a => a.isActive).length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}>
                  {metaAdAccounts.filter(a => a.isActive).length} {metaAdAccounts.filter(a => a.isActive).length === 1 ? 'account' : 'accounts'}
                </span>
              )}
              <a
                href={`/api/meta-ads/oauth/connect?workspaceId=${workspaceId}`}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {metaAdAccounts.length > 0 ? '+ Add account' : 'Connect Meta Ads'}
              </a>
            </div>
          </div>

          {metaAdAccounts.length > 0 && (
            <div className="space-y-1 mb-2">
              {metaAdAccounts.map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--surface-secondary)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.accountName}</p>
                    <p className="text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>act_{a.metaAccountId}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                      <input
                        type="checkbox"
                        checked={a.autoPilotEnabled}
                        disabled={busyAdAccount === a.id}
                        onChange={(e) => toggleAdAccount('meta', a.id, 'autoPilotEnabled', e.target.checked)}
                        className="w-3 h-3"
                      />
                      Autopilot
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                      <input
                        type="checkbox"
                        checked={a.isActive}
                        disabled={busyAdAccount === a.id}
                        onChange={(e) => toggleAdAccount('meta', a.id, 'isActive', e.target.checked)}
                        className="w-3 h-3"
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      onClick={() => disconnectAdAccount('meta', a.id, a.accountName)}
                      disabled={busyAdAccount === a.id}
                      className="text-xs hover:opacity-100 transition-opacity disabled:opacity-30"
                      style={{ color: 'var(--accent-red)' }}
                      title="Disconnect"
                    >
                      {busyAdAccount === a.id ? '…' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {metaAdAccounts.length === 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
              Connect Meta Ads to draft, launch, and optimise Facebook and Instagram campaigns from inside Voxility. Requires the Marketing API permissions on your Meta App and a user with the &quot;Manage campaigns&quot; task on the ad account.
            </p>
          )}
        </div>

        {/* Google Ads — Search, Performance Max, Display, etc. */}
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0">
                {/* Inline G mark — avoids pulling in another brand-icons file
                    just for the Ads variant. The G is universally recognised. */}
                <svg viewBox="0 0 24 24" className="w-7 h-7" aria-hidden>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Google Ads</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Search, Performance Max, Display, and YouTube campaigns</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {googleAdAccounts.filter(a => a.isActive).length > 0 && (
                <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}>
                  {googleAdAccounts.filter(a => a.isActive).length} {googleAdAccounts.filter(a => a.isActive).length === 1 ? 'customer' : 'customers'}
                </span>
              )}
              <a
                href={`/api/google-ads/oauth/connect?workspaceId=${workspaceId}`}
                className="text-xs px-3 py-1.5 rounded-lg border transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                {googleAdAccounts.length > 0 ? '+ Add customer' : 'Connect Google Ads'}
              </a>
            </div>
          </div>

          {googleAdAccounts.length > 0 && (
            <div className="space-y-1 mb-2">
              {googleAdAccounts.map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: 'var(--surface-secondary)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{a.accountName}</p>
                    <p className="text-[11px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{formatGoogleCustomerId(a.googleCustomerId)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                      <input
                        type="checkbox"
                        checked={a.autoPilotEnabled}
                        disabled={busyAdAccount === a.id}
                        onChange={(e) => toggleAdAccount('google', a.id, 'autoPilotEnabled', e.target.checked)}
                        className="w-3 h-3"
                      />
                      Autopilot
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: 'var(--text-tertiary)' }}>
                      <input
                        type="checkbox"
                        checked={a.isActive}
                        disabled={busyAdAccount === a.id}
                        onChange={(e) => toggleAdAccount('google', a.id, 'isActive', e.target.checked)}
                        className="w-3 h-3"
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      onClick={() => disconnectAdAccount('google', a.id, a.accountName)}
                      disabled={busyAdAccount === a.id}
                      className="text-xs hover:opacity-100 transition-opacity disabled:opacity-30"
                      style={{ color: 'var(--accent-red)' }}
                      title="Disconnect"
                    >
                      {busyAdAccount === a.id ? '…' : 'Disconnect'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {googleAdAccounts.length === 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
              Connect Google Ads to draft, launch, and optimise Search, Performance Max, Display, and YouTube campaigns. Requires <code style={{ color: 'var(--accent-primary)' }}>GOOGLE_DEVELOPER_TOKEN</code> on the deployment and access to at least one Google Ads customer.
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
