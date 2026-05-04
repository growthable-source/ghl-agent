/**
 * Email and phone normalisation for native CRM writes. Both the adapter
 * and the import pipeline funnel through these so the suppression list
 * and dedupe indexes always compare apples to apples.
 */

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const trimmed = email.trim().toLowerCase()
  if (!trimmed) return null
  // Cheap shape check — anything past this still might bounce, but at
  // least we don't store "  ", "no email", or pure whitespace.
  if (!trimmed.includes('@') || !trimmed.includes('.')) return null
  return trimmed
}

/**
 * Best-effort E.164 normalisation without pulling in libphonenumber. Falls
 * back to digit-only when the format is ambiguous so callers can still
 * dedupe on it. If you need strict validation, do it at the form layer.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  if (!trimmed) return null

  // Already E.164-ish? Keep the leading +, strip everything else.
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits ? `+${digits}` : null
  }

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null

  // 10-digit US/CA → assume +1. 11-digit starting with 1 → +1<rest>.
  // Anything else: store digits as-is so equality dedupe still works,
  // and the operator can fix it via the contact UI if needed.
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return `+${digits}`
}
