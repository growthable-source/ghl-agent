/**
 * Which paths on the public site get the LeadConnector sales chat widget.
 *
 * Split out of components/LeadConnectorChat.tsx so the rule is a pure
 * function the unit harness can cover (vitest only picks up lib/**).
 * The component owns the script injection and the show/hide plumbing;
 * this file owns the one decision that is easy to get subtly wrong.
 *
 * The widget belongs on "the website" and must stay off "the product".
 * The costly mistake is not a missing bubble on a marketing page — it is
 * a bubble on /widget/* or /c/*, where the page IS a customer's own
 * Xovera chat widget and ours would sit on top of theirs.
 */

/**
 * App surfaces, by path prefix.
 *
 *   /dashboard, /admin, /portal   operator + customer app surfaces
 *   /embedded                     the LeadConnector marketplace iframe
 *   /widget, /c, /kiosk           a *customer's* widget / hosted call page
 *   /copilot                      the co-browse overlay
 *   /knowledge-share              one-off shared knowledge links
 */
export const CHAT_EXCLUDED_PREFIXES = [
  '/dashboard',
  '/admin',
  '/portal',
  '/embedded',
  '/widget',
  '/c',
  '/kiosk',
  '/copilot',
  '/knowledge-share',
] as const

/**
 * True when `pathname` is a public marketing / landing page.
 *
 * Prefixes match on a segment boundary only — `/compare` must not be
 * swallowed by `/c`, and `/copilot-pricing` (were we to add it) must not
 * be swallowed by `/copilot`. Trailing slashes are tolerated because
 * `usePathname()` reflects whatever the visitor typed.
 */
export function isPublicChatPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return !CHAT_EXCLUDED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + '/'),
  )
}
