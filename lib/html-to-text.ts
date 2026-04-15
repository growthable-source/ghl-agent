/**
 * Lightweight HTML-to-plain-text converter.
 *
 * Strips all HTML tags, decodes common entities, normalises whitespace.
 * Used to clean email bodies before storing in message logs and passing
 * to the AI agent (which should see the text, not the markup).
 */

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '–',
  '&mdash;': '—',
  '&bull;': '•',
  '&hellip;': '…',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&#x3D;': '=',
  '&laquo;': '«',
  '&raquo;': '»',
}

/**
 * Returns true if the string looks like it contains HTML (has at least one
 * tag-like pattern).
 */
export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(text)
}

/**
 * Converts HTML to readable plain text.
 *
 * - Replaces <br>, <p>, <div>, <li>, heading, and <tr> tags with newlines
 * - Extracts href from <a> tags and appends as [url]
 * - Strips all remaining HTML tags
 * - Decodes HTML entities (named + numeric)
 * - Collapses excessive whitespace and blank lines
 */
export function htmlToText(html: string): string {
  if (!html) return ''

  // If it doesn't look like HTML, return as-is
  if (!looksLikeHtml(html)) return html.trim()

  let text = html

  // Remove <style> and <script> blocks entirely
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // Block-level elements → newlines
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/p>/gi, '\n\n')
  text = text.replace(/<\/div>/gi, '\n')
  text = text.replace(/<\/h[1-6]>/gi, '\n\n')
  text = text.replace(/<\/tr>/gi, '\n')
  text = text.replace(/<\/li>/gi, '\n')
  text = text.replace(/<li[\s>]/gi, '• ')
  text = text.replace(/<hr\s*\/?>/gi, '\n---\n')
  text = text.replace(/<\/td>\s*<td/gi, ' | <td')

  // Extract link text + href: <a href="URL">text</a> → text [URL]
  text = text.replace(/<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, linkText) => {
    const cleanLinkText = linkText.replace(/<[^>]+>/g, '').trim()
    if (!cleanLinkText || cleanLinkText === href) return href
    return `${cleanLinkText} [${href}]`
  })

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode named entities
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    text = text.replaceAll(entity, char)
  }

  // Decode numeric entities (decimal &#123; and hex &#x1F;)
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

  // Collapse runs of spaces/tabs on the same line (preserve newlines)
  text = text.replace(/[^\S\n]+/g, ' ')

  // Collapse 3+ newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n')

  // Trim each line
  text = text
    .split('\n')
    .map(line => line.trim())
    .join('\n')

  return text.trim()
}
