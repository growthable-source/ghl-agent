/**
 * Fetch a single Google Drive file's text content for knowledge ingestion.
 *
 * Native Google formats (Docs/Sheets/Slides) are exported to text/CSV via the
 * Drive export endpoint; binary files (PDF/txt/md) are downloaded with
 * alt=media and parsed the same way the upload route does. Access is scoped to
 * `drive.file`, so only files the operator picked via the Google Picker are
 * readable — this never sees the rest of the drive.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB hard ceiling per file

// Native Google MIME types → the export MIME we ask Drive for.
const EXPORT_MAP: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
}

export interface DriveFileRef {
  id: string
  name: string
  mimeType: string
}

export interface DriveFetchResult {
  name: string
  text: string
}

/**
 * Returns extracted text for a picked Drive file, or throws with a message
 * suitable for surfacing to the operator. Unsupported types throw rather than
 * silently producing empty knowledge.
 */
export async function fetchDriveFileText(accessToken: string, file: DriveFileRef): Promise<DriveFetchResult> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  const exportMime = EXPORT_MAP[file.mimeType]

  if (exportMime) {
    const url = `${DRIVE_API}/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportMime)}`
    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(`Drive export failed for "${file.name}" (${res.status})`)
    const text = await res.text()
    return { name: file.name, text: text.trim() }
  }

  // Binary download. Guard size before reading the whole body.
  const res = await fetch(`${DRIVE_API}/${encodeURIComponent(file.id)}?alt=media`, { headers })
  if (!res.ok) throw new Error(`Drive download failed for "${file.name}" (${res.status})`)

  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength > MAX_BYTES) throw new Error(`"${file.name}" is too large (max 10MB)`)

  const ext = file.name.split('.').pop()?.toLowerCase()
  if (file.mimeType === 'application/pdf' || ext === 'pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buf })
    const result = await parser.getText()
    return { name: file.name, text: (result.text ?? '').trim() }
  }
  if (file.mimeType.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'csv') {
    return { name: file.name, text: new TextDecoder().decode(buf).trim() }
  }

  throw new Error(`Unsupported file type for "${file.name}" (${file.mimeType}). Use Docs, Sheets, Slides, PDF, txt, md, or csv.`)
}
