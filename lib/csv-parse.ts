/**
 * Minimal RFC 4180 CSV parser. Handles:
 *  - quoted fields with embedded commas, newlines, and escaped quotes ("")
 *  - both \r\n and \n line endings
 *  - trailing newlines
 *
 * No dependency on a third-party lib; the import flow doesn't need
 * full CSV-spec coverage (custom delimiters, charset detection, etc.).
 * If a customer's file is too exotic, they'll see per-row errors and
 * can clean it up.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"') { inQuotes = true; i++; continue }
    if (ch === ',') { row.push(field); field = ''; i++; continue }
    if (ch === '\r') { i++; continue }
    if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''; i++; continue
    }
    field += ch; i++
  }
  // flush final field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}
