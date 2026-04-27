/**
 * Runtime support for workspace-scoped data sources. Three kinds:
 *
 *   google_sheet — public Google Sheets via CSV export. No OAuth needed.
 *                  config: { url: string, sheetName?: string }
 *
 *   airtable     — base + table, optionally a filter formula. Requires a
 *                  Personal Access Token stored encrypted in secretEnc.
 *                  config: { baseId: string, tableName: string,
 *                            view?: string, fields?: string[] }
 *
 *   rest_get     — saved GET endpoint. Optional Bearer token in secretEnc.
 *                  config: { url: string, headers?: Record<string,string> }
 *
 * Each helper returns a string the agent can drop into its reply / reason
 * over. Errors return a string starting with "Error:" so the model knows
 * the source failed without us having to throw.
 */

import { db } from './db'
import { decryptSecret } from './secrets'

export type DataSourceKind = 'google_sheet' | 'airtable' | 'rest_get'

export interface DataSourceConfig {
  url?: string
  sheetName?: string
  baseId?: string
  tableName?: string
  view?: string
  fields?: string[]
  headers?: Record<string, string>
}

export interface LoadedDataSource {
  id: string
  workspaceId: string
  name: string
  kind: DataSourceKind
  description: string | null
  config: DataSourceConfig
  secretEnc: string | null
}

export async function listActiveDataSources(workspaceId: string): Promise<LoadedDataSource[]> {
  try {
    const rows = await (db as any).workspaceDataSource.findMany({
      where: { workspaceId, isActive: true },
    })
    return rows as LoadedDataSource[]
  } catch (err: any) {
    if (
      err?.code === 'P2021' || err?.code === 'P2022'
      || /relation .* does not exist/i.test(err?.message ?? '')
    ) return []
    throw err
  }
}

async function loadByName(workspaceId: string, name: string): Promise<LoadedDataSource | null> {
  try {
    const row = await (db as any).workspaceDataSource.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    })
    return row as LoadedDataSource | null
  } catch { return null }
}

const RESPONSE_CHAR_CAP = 8000

function cap(s: string): string {
  if (s.length <= RESPONSE_CHAR_CAP) return s
  return s.slice(0, RESPONSE_CHAR_CAP) + `\n…(truncated; ${s.length - RESPONSE_CHAR_CAP} more chars)`
}

// ── Google Sheets (public CSV export) ─────────────────────────────────────
function googleSheetCsvUrl(input: string, sheetName?: string): string | null {
  // Accept the share URL "https://docs.google.com/spreadsheets/d/<id>/edit#gid=…"
  // or just the spreadsheet id.
  const idMatch = input.match(/\/d\/([a-zA-Z0-9-_]+)/)
  const id = idMatch?.[1] || (/^[a-zA-Z0-9-_]{20,}$/.test(input.trim()) ? input.trim() : null)
  if (!id) return null
  // gid (specific sheet tab) — pull from the original URL if present
  const gidMatch = input.match(/[#&]gid=(\d+)/)
  const params = new URLSearchParams()
  params.set('format', 'csv')
  if (gidMatch) params.set('gid', gidMatch[1])
  if (sheetName) params.set('sheet', sheetName)
  return `https://docs.google.com/spreadsheets/d/${id}/export?${params.toString()}`
}

export async function runSheetLookup(args: {
  workspaceId: string
  source: string
  query?: string
}): Promise<string> {
  const ds = await loadByName(args.workspaceId, args.source)
  if (!ds || ds.kind !== 'google_sheet') return `Error: data source "${args.source}" not found or not a Google Sheet.`
  const csvUrl = googleSheetCsvUrl(ds.config.url || '', ds.config.sheetName)
  if (!csvUrl) return `Error: data source "${args.source}" has no usable Sheet URL.`

  let csv: string
  try {
    const res = await fetch(csvUrl, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return `Error: Sheet fetch returned ${res.status} (is the sheet shared as "Anyone with the link"?)`
    csv = await res.text()
  } catch (e: any) {
    return `Error: Sheet fetch failed — ${e.message}`
  }

  if (!args.query || !args.query.trim()) {
    return cap(csv)
  }
  // Cheap filter: keep header + any line that contains the query (case-insensitive)
  const lines = csv.split(/\r?\n/)
  const header = lines[0] || ''
  const q = args.query.toLowerCase()
  const matches = lines.slice(1).filter(l => l.toLowerCase().includes(q))
  if (matches.length === 0) return `No rows matched "${args.query}".\n\nHeader: ${header}`
  return cap([header, ...matches].join('\n'))
}

// ── Airtable ──────────────────────────────────────────────────────────────
export async function runAirtableQuery(args: {
  workspaceId: string
  source: string
  formula?: string
  maxRecords?: number
}): Promise<string> {
  const ds = await loadByName(args.workspaceId, args.source)
  if (!ds || ds.kind !== 'airtable') return `Error: data source "${args.source}" not found or not an Airtable base.`
  if (!ds.secretEnc) return `Error: data source "${args.source}" has no API token configured.`
  if (!ds.config.baseId || !ds.config.tableName) return `Error: data source "${args.source}" is missing baseId or tableName.`

  let token: string
  try { token = decryptSecret(ds.secretEnc) } catch {
    return `Error: could not decrypt Airtable token (server SECRETS_ENCRYPTION_KEY may have changed).`
  }

  const url = new URL(`https://api.airtable.com/v0/${ds.config.baseId}/${encodeURIComponent(ds.config.tableName)}`)
  url.searchParams.set('maxRecords', String(Math.min(Math.max(args.maxRecords ?? 10, 1), 50)))
  if (args.formula) url.searchParams.set('filterByFormula', args.formula)
  if (ds.config.view) url.searchParams.set('view', ds.config.view)
  if (ds.config.fields && ds.config.fields.length > 0) {
    for (const f of ds.config.fields) url.searchParams.append('fields[]', f)
  }

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return `Error: Airtable returned ${res.status}: ${body.slice(0, 200)}`
    }
    const data = await res.json() as { records?: Array<{ id: string; fields: Record<string, unknown> }> }
    if (!data.records || data.records.length === 0) {
      return `No records matched.`
    }
    const rendered = data.records.map(r => {
      const pairs = Object.entries(r.fields).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
      return pairs.join(' · ')
    }).join('\n')
    return cap(rendered)
  } catch (e: any) {
    return `Error: Airtable fetch failed — ${e.message}`
  }
}

// ── Generic REST GET ──────────────────────────────────────────────────────
export async function runRestGet(args: {
  workspaceId: string
  source: string
}): Promise<string> {
  const ds = await loadByName(args.workspaceId, args.source)
  if (!ds || ds.kind !== 'rest_get') return `Error: data source "${args.source}" not found or not a REST endpoint.`
  if (!ds.config.url) return `Error: data source "${args.source}" has no URL.`

  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (ds.config.headers) Object.assign(headers, ds.config.headers)
  if (ds.secretEnc) {
    try { headers['Authorization'] = `Bearer ${decryptSecret(ds.secretEnc)}` } catch {}
  }

  try {
    const res = await fetch(ds.config.url, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return `Error: ${ds.config.url} returned ${res.status}: ${body.slice(0, 200)}`
    }
    const text = await res.text()
    return cap(text)
  } catch (e: any) {
    return `Error: REST fetch failed — ${e.message}`
  }
}

/**
 * Build the prompt fragment that lists available data sources for an
 * agent's workspace, so Claude knows which `source` slugs to pass into
 * each tool. Returned string is empty when there are no sources.
 */
export function describeDataSources(sources: LoadedDataSource[]): string {
  if (sources.length === 0) return ''
  const byKind: Record<DataSourceKind, LoadedDataSource[]> = {
    google_sheet: [],
    airtable: [],
    rest_get: [],
  }
  for (const s of sources) byKind[s.kind]?.push(s)

  const parts: string[] = []
  if (byKind.google_sheet.length > 0) {
    parts.push(
      'For lookup_sheet, available source names:\n' +
      byKind.google_sheet.map(s => `  - "${s.name}"${s.description ? ` — ${s.description}` : ''}`).join('\n')
    )
  }
  if (byKind.airtable.length > 0) {
    parts.push(
      'For query_airtable, available source names:\n' +
      byKind.airtable.map(s => `  - "${s.name}"${s.description ? ` — ${s.description}` : ''}`).join('\n')
    )
  }
  if (byKind.rest_get.length > 0) {
    parts.push(
      'For fetch_data, available source names:\n' +
      byKind.rest_get.map(s => `  - "${s.name}"${s.description ? ` — ${s.description}` : ''}`).join('\n')
    )
  }
  return '\n\n## Live Data Sources\n' + parts.join('\n\n')
}
