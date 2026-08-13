'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useSyncExternalStore } from 'react'
import { isPublicChatPath } from '@/lib/leadconnector-chat-paths'
import {
  subscribePublicChatSuppressed,
  getPublicChatSuppressed,
  getPublicChatSuppressedServer,
  getPublicChatSuppressed as readPublicChatSuppressed,
} from '@/lib/leadconnector-chat-suppress'

/**
 * Xovera — LeadConnector chat widget on the public site
 *
 * The sales/support chat widget that runs on the marketing + landing
 * pages served from app.xovera.io (and xovera.io — same Next app, same
 * visitors). It is the stock LeadConnector snippet:
 *
 *   <script src="https://widgets.leadconnectorhq.com/loader.js"
 *           data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js"
 *           data-widget-id="6a7532e0f39c9f20f8033a5b"></script>
 *
 * ...wrapped in a component instead of pasted into `app/layout.tsx`
 * verbatim, for one reason: the root layout also renders the logged-in
 * product. A raw <script> there would put a LeadConnector chat bubble
 * inside the operator dashboard, the marketplace iframe, the customer
 * portal, and — worst of all — inside /widget/* and /c/*, where the page
 * IS a customer's own Xovera chat widget. Two chat bubbles fighting for
 * the bottom-right corner, one of them ours-but-not-theirs.
 *
 * So: mounted globally, suppressed on every app surface. The path rule
 * itself lives in lib/leadconnector-chat-paths.ts (pure + unit-tested).
 *
 * Navigation between the two worlds is client-side (the marketing nav
 * links straight into /login → /dashboard), so "suppressed" has to mean
 * *reactive*, not just "we skipped the injection on first paint". Hence
 * the two-part mechanism below:
 *
 *   1. The loader script is injected once, lazily, the first time the
 *      visitor is on a public path. It is never removed — LeadConnector's
 *      loader has no teardown, and re-running it on every route change
 *      would re-mount the widget (and lose the open conversation).
 *   2. Visibility is driven by `data-lc-chat` on <html>, which flips on
 *      every pathname change. The CSS rule below hides the widget's host
 *      element while it is "off"; we also call the widget's own
 *      hide/show API when it happens to be exposed, so the iframe stops
 *      doing work rather than just going invisible.
 *
 * The CSS is the load-bearing half of that pair (the JS API is a
 * best-effort nicety) — if LeadConnector ever renames its host element,
 * update HIDE_CSS, not the API calls.
 */

const WIDGET_ID = process.env.NEXT_PUBLIC_LEADCONNECTOR_WIDGET_ID || '6a7532e0f39c9f20f8033a5b'
const LOADER_SRC = 'https://widgets.leadconnectorhq.com/loader.js'
const RESOURCES_URL = 'https://widgets.leadconnectorhq.com/chat-widget/loader.js'

const SCRIPT_ID = 'leadconnector-chat-loader'

/**
 * `chat-widget` is the custom element LeadConnector's loader appends to
 * <body>; the sibling selectors cover the wrapper names it has shipped
 * under. Extra selectors cost nothing and save a support ticket if the
 * markup shifts.
 */
const HIDE_CSS = `html[data-lc-chat="off"] chat-widget,
html[data-lc-chat="off"] #lc_text-widget,
html[data-lc-chat="off"] .lc_text-widget--wrapper { display: none !important; }`

declare global {
  interface Window {
    leadConnector?: {
      chatWidget?: {
        hideWidget?: () => void
        showWidget?: () => void
      }
    }
  }
}

export default function LeadConnectorChat() {
  const pathname = usePathname()
  // A page can veto the widget even on a public path — see
  // lib/leadconnector-chat-suppress.ts. Used by the whitelabel demo
  // landers, where a Xovera bubble on a partner-branded page is a leak.
  const suppressed = useSyncExternalStore(
    subscribePublicChatSuppressed,
    getPublicChatSuppressed,
    getPublicChatSuppressedServer,
  )
  const show = isPublicChatPath(pathname ?? '/') && !suppressed

  useEffect(() => {
    // Re-read the store rather than trusting the `show` computed at render
    // time: a page can mark itself suppressed DURING render (see
    // app/try/[slug]/sections/SuppressPublicChat.tsx), which lands after
    // this component rendered but before this effect runs. Without the
    // re-read we would inject the loader on a whitelabel lander and only
    // then hide it.
    const on = show && !readPublicChatSuppressed()

    // Flip visibility first — on a marketing → dashboard navigation this
    // runs before anything paints the app shell, so the bubble does not
    // linger for a frame.
    document.documentElement.dataset.lcChat = on ? 'on' : 'off'

    const api = window.leadConnector?.chatWidget
    if (on) api?.showWidget?.()
    else api?.hideWidget?.()

    if (!on) return
    if (document.getElementById(SCRIPT_ID)) return

    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.src = LOADER_SRC
    script.async = true
    script.setAttribute('data-resources-url', RESOURCES_URL)
    script.setAttribute('data-widget-id', WIDGET_ID)
    document.body.appendChild(script)
    // Deliberately no cleanup: the loader is injected once per page load
    // and torn down by the browser on a full navigation. Removing the
    // <script> would not unmount the widget anyway.
  }, [show])

  return <style dangerouslySetInnerHTML={{ __html: HIDE_CSS }} />
}
