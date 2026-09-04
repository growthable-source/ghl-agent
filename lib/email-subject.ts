/**
 * One-line-ification for email subject headers.
 *
 * Why this exists: a subject is an RFC 5322 header, and headers can't
 * carry bare CR/LF — a newline in the middle of one either terminates
 * the header early (classic header-injection) or, with a sane provider
 * in front, gets rejected outright. Resend rejects it: HTTP 422
 * validation_error naming the `subject` field.
 *
 * We hit this for real. Ticket subjects are derived from whatever the
 * requester/operator typed — a pasted multi-line error out of Meta Ads
 * Manager, a chat message with a hard wrap — and none of the creation
 * paths flattened it. Ticket subjects render as HTML in the dashboard
 * so the newlines collapse to spaces on screen, which is why nothing
 * looked wrong until the reply email bounced off Resend's validator.
 *
 * Sanitising here (rather than only at creation) is deliberate: it is
 * the last gate before the header goes out, so it also covers the
 * tickets already sitting in the DB with newlines in them.
 */

/** RFC 5322 allows 998 chars per header line, but a subject that long
 *  is useless in every mail client. 200 keeps the `[#N] ` prefix and a
 *  `Re:` chain comfortably inside one line. */
const DEFAULT_MAX = 200

export function sanitizeEmailSubject(
  raw: string | null | undefined,
  opts: { maxLength?: number; fallback?: string } = {},
): string {
  const max = opts.maxLength ?? DEFAULT_MAX
  const fallback = opts.fallback ?? '(no subject)'

  const flat = (raw ?? '')
    // C0 controls (incl. CR/LF/tab), DEL, C1 controls, and the Unicode
    // line/paragraph separators that smuggle a break past a naive \n
    // check — all become a space. Replacing rather than dropping keeps
    // word boundaries: a subject broken across lines reads "one two",
    // not "onetwo".
    .replace(/[\x00-\x1F\x7F-\x9F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!flat) return fallback
  if (flat.length <= max) return flat
  return flat.slice(0, max - 1).trimEnd() + '…'
}
