/**
 * Runtime override that lets a page switch the LeadConnector sales chat
 * off, on top of the path rule in lib/leadconnector-chat-paths.ts.
 *
 * WHY A STORE AND NOT A PROP/CONTEXT
 * <LeadConnectorChat /> is mounted in the root layout as a SIBLING that
 * renders *before* {children}, so a page cannot pass it a prop, and any
 * provider a page rendered would sit below it. It also renders (and runs
 * its effect) before the page does, so a child effect cannot pre-empt the
 * decision — the widget has to be able to *react* to a later signal.
 * Hence a tiny external store the component subscribes to.
 *
 * WHY IT EXISTS AT ALL
 * The whitelabel demo landers (lib/demo-brands) render `/try/[slug]` under
 * a partner's identity — ASC Warranty's logo, palette and copy. A Xovera
 * sales-chat bubble in the corner of that page is a straight brand leak:
 * the prospect is being sold to by a company the page never mentions, and
 * it hands them a second, competing conversation right next to the demo's
 * own CTA. The path rule can't express this on its own because the brand
 * lives on the DemoProspect row, not in the URL — two `/try/*` pages can
 * legitimately disagree.
 *
 * Xovera-branded landers are untouched: they keep the bubble exactly as
 * before, because only a non-default brand flips this.
 */

let suppressed = false
const listeners = new Set<() => void>()

/**
 * Set the flag WITHOUT notifying subscribers. Safe to call during render,
 * which is the point: all renders finish before any effect runs, so a page
 * that marks during render is visible to <LeadConnectorChat />'s effect
 * even though that effect runs first. Notifying here instead would try to
 * re-render another component mid-render, which React warns about — so the
 * caller pairs this with `notifyPublicChatSuppressed()` in an effect.
 */
export function markPublicChatSuppressed(next: boolean): void {
  suppressed = next
}

/** Publish the current value to subscribers. Effect-phase only. */
export function notifyPublicChatSuppressed(): void {
  for (const l of listeners) l()
}

export function setPublicChatSuppressed(next: boolean): void {
  if (suppressed === next) return
  suppressed = next
  notifyPublicChatSuppressed()
}

export function subscribePublicChatSuppressed(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPublicChatSuppressed(): boolean {
  return suppressed
}

/** Server snapshot for useSyncExternalStore — never suppressed during SSR,
 *  which matches the pre-existing markup and avoids a hydration mismatch.
 *  The client flips it in an effect on the pages that need it. */
export function getPublicChatSuppressedServer(): boolean {
  return false
}
