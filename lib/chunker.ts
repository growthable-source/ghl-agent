// Rough token estimate: 1 token ≈ 4 chars
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// Split text into chunks of ~400 tokens (~1600 chars) with overlap
export function chunkText(text: string, maxChars = 1600): string[] {
  // Clean up whitespace
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxChars) return [cleaned]

  const chunks: string[] = []
  let start = 0

  while (start < cleaned.length) {
    let end = start + maxChars

    // Try to break at sentence boundary
    if (end < cleaned.length) {
      const breakAt = cleaned.lastIndexOf('. ', end)
      if (breakAt > start + maxChars / 2) end = breakAt + 1
    }

    chunks.push(cleaned.slice(start, end).trim())
    start = end - 200 // 200 char overlap
    if (start >= cleaned.length - 100) break
  }

  return chunks.filter(c => c.length > 100)
}

// Strip HTML tags and decode common entities
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// Extract page title from HTML
export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return match ? match[1].trim() : 'Untitled'
}
