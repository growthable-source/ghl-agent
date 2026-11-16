/**
 * Lookup keys for "does this URL already have live chunks?"
 *
 * The ingest skip-check used to be
 *
 *   sourceUrl ILIKE '%//host%'
 *
 * with no LIMIT. A host that already had ~35k chunks returned every
 * one of them (one row per chunk, not per page) just to answer "which
 * of THESE discovered URLs are indexed?". Callers only consult the
 * result for the URLs they just discovered, so the probe is the
 * discovered URL plus the spellings we already treat as the same page
 * (scheme, host case, a single trailing slash). Exact equality on
 * lower(sourceUrl) — not a host-wide contains — keeps the result to
 * those URLs.
 *
 * Path case is folded only for the probe. canonicalUrlKey still decides
 * whether two hits are the same page, so a case-only path collision
 * does not skip a real fetch.
 */

export function sourceUrlLookupVariants(raw: string): string[] {
  const out = new Set<string>()
  const add = (value: string) => {
    const trimmed = value.trim()
    if (trimmed) out.add(trimmed.toLowerCase())
  }
  if (!raw) return []
  add(raw)

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return [...out]
  }

  const host = url.host.toLowerCase()
  const search = url.search
  const path = url.pathname || '/'
  const paths = new Set<string>([path])
  if (path.length > 1 && path.endsWith('/')) paths.add(path.slice(0, -1))
  else if (path !== '/') paths.add(`${path}/`)
  if (path === '/' || path === '') {
    paths.add('/')
    paths.add('')
  }

  for (const scheme of ['https', 'http']) {
    for (const p of paths) {
      if (p === '') {
        add(`${scheme}://${host}${search}`)
        add(`${scheme}://${host}/${search}`)
      } else {
        add(`${scheme}://${host}${p}${search}`)
      }
    }
  }
  return [...out]
}
