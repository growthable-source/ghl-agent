/**
 * Tiny CSV encoder used by the admin export routes.
 *
 * Keeps the API surface minimal: build a 2-D array of rows (header
 * first), call toCsv(rows), get a string. No streaming — the admin
 * exports are bounded by a hard row cap so memory is predictable.
 */

const MAX_EXPORT_ROWS = 50_000

export const ADMIN_EXPORT_ROW_CAP = MAX_EXPORT_ROWS

export function toCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map(r => r.map(cell => csvEscape(cell)).join(',')).join('\r\n')
}

function csvEscape(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : String(v)
  // RFC 4180 — quote the field if it contains comma, quote, CR, LF,
  // and escape inner quotes by doubling.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // Exports are live — never cache.
      'Cache-Control': 'no-store',
    },
  })
}
