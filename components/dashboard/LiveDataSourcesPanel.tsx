'use client'

/**
 * Live data sources panel for the agent Knowledge tab.
 *
 * Surfaces every workspace-level integration that the agent calls
 * LIVE during a conversation (as opposed to indexed text that gets
 * baked into the prompt). Today that's Shopify; future integrations
 * (Stripe, Calendly, Klaviyo, …) plug in here.
 *
 * The user-facing framing is "your agent can already access this
 * data — here's the proof, and here's the connect/disconnect button."
 * Customers used to wonder whether their voice agent was actually
 * checking inventory; now there's a card that says so unambiguously.
 *
 * Connection is workspace-level (one shop per workspace), so flipping
 * the toggle here affects every agent in the workspace. We surface
 * that fact in the disconnect confirm dialog.
 */

import { useEffect, useState } from 'react'

interface ShopifyStatus {
  connected: boolean
  shop?: string
  scope?: string
  installedAt?: string
}

export default function LiveDataSourcesPanel({ workspaceId }: { workspaceId: string }) {
  const [shopify, setShopify] = useState<ShopifyStatus | null>(null)
  const [shopInput, setShopInput] = useState('')
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/shopify`)
      .then(r => (r.ok ? r.json() : { connected: false }))
      .then((d: ShopifyStatus) => {
        if (!cancelled) setShopify(d)
      })
      .catch(() => {
        if (!cancelled) setShopify({ connected: false })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId])

  function connectShopify() {
    let shop = shopInput.trim().toLowerCase()
    shop = shop.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (shop && !shop.includes('.')) shop = `${shop}.myshopify.com`
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      setBanner({ kind: 'error', text: 'Enter a valid Shopify domain like "yourstore.myshopify.com"' })
      return
    }
    // OAuth flow — server-redirect to Shopify's authorize URL with our
    // app key, then back to our callback. Same install route used by
    // the Integrations page.
    window.location.href = `/api/auth/shopify/install?shop=${encodeURIComponent(shop)}&workspaceId=${workspaceId}`
  }

  async function disconnectShopify() {
    const confirmed = window.confirm(
      'Disconnect Shopify from this workspace?\n\nEvery agent in this workspace will lose inventory awareness, order lookups, customer history, and the ability to mint discount codes. Your store data on Shopify is untouched — this only pauses our access.',
    )
    if (!confirmed) return
    setDisconnecting(true)
    setBanner(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/shopify`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      setShopify({ connected: false })
      setBanner({ kind: 'success', text: 'Shopify disconnected. Reconnect anytime.' })
    } catch (err: any) {
      setBanner({ kind: 'error', text: `Disconnect failed: ${err.message}` })
    } finally {
      setDisconnecting(false)
    }
  }

  if (loading) {
    return (
      <div
        className="rounded-xl p-5"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <div className="h-4 w-40 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
    )
  }

  return (
    <div
      className="rounded-xl p-5 space-y-4"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Live data sources
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Sources the agent queries live during a conversation. Connections are workspace-wide
          — toggling one here affects every agent in this workspace.
        </p>
      </div>

      {/* Shopify card */}
      <ShopifyCard
        status={shopify}
        shopInput={shopInput}
        onShopInput={setShopInput}
        onConnect={connectShopify}
        onDisconnect={disconnectShopify}
        disconnecting={disconnecting}
        banner={banner}
        onClearBanner={() => setBanner(null)}
      />
    </div>
  )
}

// ─── Shopify card ────────────────────────────────────────────────────

function ShopifyCard({
  status, shopInput, onShopInput, onConnect, onDisconnect, disconnecting, banner, onClearBanner,
}: {
  status: ShopifyStatus | null
  shopInput: string
  onShopInput: (v: string) => void
  onConnect: () => void
  onDisconnect: () => void
  disconnecting: boolean
  banner: { kind: 'success' | 'error'; text: string } | null
  onClearBanner: () => void
}) {
  const connected = !!status?.connected

  return (
    <div
      className="rounded-lg p-4 space-y-3"
      style={{
        border: connected ? '1px solid rgba(34,197,94,0.35)' : '1px solid var(--border)',
        background: connected ? 'rgba(34,197,94,0.06)' : 'var(--surface-secondary)',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Shopify mark */}
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
          style={{ background: connected ? 'rgba(34,197,94,0.18)' : 'var(--surface-tertiary)' }}
          aria-hidden
        >
          🛍️
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Shopify
            </p>
            {connected && (
              <span
                className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded"
                style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
              >
                Connected
              </span>
            )}
          </div>
          {connected ? (
            <p className="text-xs mt-0.5 font-mono break-all" style={{ color: 'var(--text-secondary)' }}>
              {status?.shop}
            </p>
          ) : (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Connect your store and the agent can quote live prices, check inventory, look up orders,
              pull a caller&apos;s purchase history, mint discount codes, and capture back-in-stock
              interest — all during the call.
            </p>
          )}
        </div>
      </div>

      {connected ? (
        <>
          <ul className="text-xs space-y-1 pl-12" style={{ color: 'var(--text-secondary)' }}>
            <li>• Quote live prices and check variant inventory</li>
            <li>• Look up &quot;where&apos;s my order?&quot; with live tracking</li>
            <li>• Pull the caller&apos;s purchase history when recognised</li>
            <li>• Mint discount codes and text-back checkout links</li>
            <li>• Capture back-in-stock interest and notify when restocked</li>
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onDisconnect}
              disabled={disconnecting}
              className="text-xs px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </>
      ) : (
        <div className="pl-12 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={shopInput}
              onChange={e => { onShopInput(e.target.value); if (banner) onClearBanner() }}
              onKeyDown={e => { if (e.key === 'Enter') onConnect() }}
              placeholder="yourstore.myshopify.com"
              className="flex-1 min-w-[200px] rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            />
            <button
              type="button"
              onClick={onConnect}
              disabled={!shopInput.trim()}
              className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: '#fa4d2e', color: '#ffffff' }}
            >
              Connect Shopify
            </button>
          </div>
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            Opens Shopify&apos;s OAuth screen to authorise read + write access to products,
            inventory, orders, customers, and discounts. You can disconnect any time.
          </p>
        </div>
      )}

      {banner && (
        <p
          className="text-xs"
          style={{ color: banner.kind === 'error' ? '#ef4444' : 'var(--accent-emerald)' }}
        >
          {banner.text}
        </p>
      )}
    </div>
  )
}
