/**
 * The two URLs the partner's admin UI needs back from us: the embed
 * snippet the customer drops on their site, and the SSO'd builder URL it
 * iframes.
 */

export function publicBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io')
    .replace(/\/$/, '')
}

/**
 * The floating-launcher embed snippet. widget.js needs BOTH the widget id
 * and the public key — the key is what the config endpoint checks, and it
 * is not a secret (it ships in the page source; origin allowlisting is
 * what actually scopes it).
 */
export function embedSnippet(widgetId: string, publicKey: string): string {
  return `<script src="${publicBaseUrl()}/widget.js" data-widget-id="${widgetId}" data-public-key="${publicKey}" async></script>`
}

/** Entry point for the iframe. The token is consumed by the handshake on
 *  first load, so this URL is single-use — mint a fresh one per open. */
export function builderUrl(token: string): string {
  return `${publicBaseUrl()}/embedded/widget-builder?t=${encodeURIComponent(token)}`
}
