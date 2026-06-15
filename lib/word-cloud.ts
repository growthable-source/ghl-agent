/**
 * Lightweight keyword/phrase extraction for the portal word cloud.
 *
 * Pure + dependency-free: lowercase, strip punctuation, drop stopwords +
 * very short/numeric tokens, then count unigrams and bigrams. Bigrams are
 * weighted up a touch so meaningful phrases ("reset password") can beat
 * their component words. Returns the top terms by score.
 */

export interface Term {
  term: string
  count: number
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of',
  'on', 'to', 'with', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing',
  'have', 'has', 'had', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'its', 'they', 'them', 'their',
  'this', 'that', 'these', 'those', 'there', 'here', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how',
  'can', 'could', 'will', 'would', 'should', 'shall', 'may', 'might', 'must', 'not', 'no', 'yes', 'just', 'get', 'got',
  'im', 'ive', 'id', 'youre', 'dont', 'cant', 'wont', 'isnt', 'thats', 'hi', 'hey', 'hello', 'thanks', 'thank', 'please',
  'ok', 'okay', 'yeah', 'yep', 'us', 'also', 'too', 'very', 'really', 'some', 'any', 'all', 'more', 'most', 'up', 'out',
  'now', 'one', 'want', 'need', 'know', 'like', 'help', 'see', 'go', 'going', 'still', 'back', 'good', 'much', 'well',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')        // drop URLs
    .replace(/[^a-z0-9\s'-]/g, ' ')         // keep letters/digits/apostrophe/hyphen
    .replace(/['-]/g, '')                   // collapse contractions/hyphens
    .split(/\s+/)
    .filter(t => t.length >= 3 && t.length <= 24 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
}

export function topTerms(texts: string[], opts: { limit?: number; minCount?: number } = {}): Term[] {
  const limit = opts.limit ?? 30
  const minCount = opts.minCount ?? 2
  const scores = new Map<string, number>()

  for (const text of texts) {
    if (!text) continue
    const toks = tokenize(text)
    for (let i = 0; i < toks.length; i++) {
      scores.set(toks[i], (scores.get(toks[i]) ?? 0) + 1)
      // Bigram (weighted 1.5×) so real phrases surface above stray words.
      // Skip same-word bigrams ("no no", "shipping shipping") — those are
      // just a stutter/repeat, not a meaningful phrase.
      if (i + 1 < toks.length && toks[i] !== toks[i + 1]) {
        const bg = `${toks[i]} ${toks[i + 1]}`
        scores.set(bg, (scores.get(bg) ?? 0) + 1.5)
      }
    }
  }

  return Array.from(scores.entries())
    .map(([term, count]) => ({ term, count: Math.round(count) }))
    .filter(t => t.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}
