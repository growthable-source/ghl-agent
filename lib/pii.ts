/**
 * PII redaction utilities. Used when rendering log content in the dashboard
 * to mask common sensitive patterns.
 */

const PATTERNS: { name: string; regex: RegExp; mask: (match: string) => string }[] = [
  {
    name: 'ssn',
    regex: /\b(\d{3})-?(\d{2})-?(\d{4})\b/g,
    mask: () => '***-**-****',
  },
  {
    name: 'credit_card',
    regex: /\b(?:\d[ -]*?){13,16}\b/g,
    mask: m => {
      const digits = m.replace(/[^\d]/g, '')
      if (digits.length < 13) return m
      return `****-****-****-${digits.slice(-4)}`
    },
  },
  {
    name: 'email',
    regex: /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    mask: (m) => {
      const [local, domain] = m.split('@')
      if (!domain) return m
      return `${local[0]}***@${domain}`
    },
  },
  {
    name: 'phone',
    regex: /\b(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g,
    mask: m => m.replace(/\d(?=\d{4})/g, '*'),
  },
  {
    // Common API key prefixes
    name: 'api_key',
    regex: /\b(sk|rk|pk|pat)_(live|test)_[A-Za-z0-9]{16,}\b/g,
    mask: () => '[REDACTED_KEY]',
  },
]

export function redactPII(input: string | null | undefined): string {
  if (!input) return ''
  let out = input
  for (const p of PATTERNS) {
    out = out.replace(p.regex, m => p.mask(m))
  }
  return out
}

export function detectPII(input: string | null | undefined): string[] {
  if (!input) return []
  const found: string[] = []
  for (const p of PATTERNS) {
    if (p.regex.test(input)) found.push(p.name)
    // Reset regex state for global patterns
    p.regex.lastIndex = 0
  }
  return found
}
