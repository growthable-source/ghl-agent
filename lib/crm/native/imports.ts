/**
 * Native CRM imports. Accepts already-parsed rows from the upload route
 * (which can use whatever CSV parser it likes) and runs them through
 * dedupe + suppression + insert. Per-row failures land in
 * NativeContactImportRow so the operator can fix and re-upload just the
 * rejected rows.
 */

import { db } from '@/lib/db'
import { addContactsToList } from './lists'
import { createContactsBulk, findContactIdByIdentifier, type NormalisedContactRow } from './contacts'

/** Standard contact field keys the column mapper can target. */
export const STANDARD_CONTACT_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'tags',
  'source',
] as const

export type StandardContactField = typeof STANDARD_CONTACT_FIELDS[number]

/**
 * Mapping from a CSV header (or column index as a string) to either a
 * standard field, the literal "skip" sentinel, or a custom field key
 * prefixed with "custom:" (e.g. "custom:vehicle_vin").
 */
export type ColumnMapping = Record<string, StandardContactField | 'skip' | `custom:${string}`>

export interface ImportRow {
  /** 1-based row number from the original file, used for error reporting. */
  rowNumber: number
  /** Header → cell value, or the raw cell array when no headers exist. */
  data: Record<string, string | null | undefined>
}

export interface ProcessImportInput {
  workspaceId: string
  filename: string
  rows: ImportRow[]
  columnMapping: ColumnMapping
  /** When set, every successfully imported contact is added to this list. */
  listId?: string | null
  createdBy?: string
}

export interface ImportSummary {
  importId: string
  totalRows: number
  importedCount: number
  skippedCount: number
  errorCount: number
  status: 'completed' | 'failed'
}

/**
 * One-shot synchronous import. Suitable for files up to a few thousand
 * rows; larger imports should be moved to a background job since this
 * holds a transaction open for the duration. The MVP shape returns
 * counts directly so the upload UI can show a result page without
 * polling.
 */
export async function processNativeImport(input: ProcessImportInput): Promise<ImportSummary> {
  const importJob = await db.nativeContactImport.create({
    data: {
      workspaceId: input.workspaceId,
      filename: input.filename,
      status: 'processing',
      totalRows: input.rows.length,
      columnMapping: input.columnMapping as object,
      listId: input.listId ?? null,
      createdBy: input.createdBy ?? null,
    },
    select: { id: true },
  })

  const errorRows: Array<{ rowNumber: number; rawData: object; error: string }> = []
  const valid: Array<{ row: ImportRow; normalised: NormalisedContactRow }> = []

  // Stage 1: per-row validation. Anything malformed gets parked as an
  // error row immediately so we don't have to decide between "fail the
  // whole import" and "silently drop rows" — the operator sees both
  // outcomes side by side.
  for (const row of input.rows) {
    try {
      const normalised = applyMapping(row.data, input.columnMapping)
      if (!normalised.email && !normalised.phone) {
        errorRows.push({
          rowNumber: row.rowNumber,
          rawData: row.data as object,
          error: 'No email or phone provided — every contact needs at least one.',
        })
        continue
      }
      valid.push({ row, normalised })
    } catch (err) {
      errorRows.push({
        rowNumber: row.rowNumber,
        rawData: row.data as object,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // Stage 2: bulk insert, dedupe, suppression — one trip through
  // createContactsBulk handles all three.
  const bulkResult = await createContactsBulk(
    input.workspaceId,
    valid.map((v) => v.normalised),
  )

  // Stage 3: list attachment. createContactsBulk doesn't return ids
  // tied back to the originating row, so we re-resolve by identifier.
  // For typical workspace sizes (<1M contacts) this is fine; if it
  // becomes a hotspot, switch createContactsBulk to use INSERT ...
  // RETURNING and pass ids through.
  if (input.listId && bulkResult.created.length > 0) {
    await addContactsToList({
      workspaceId: input.workspaceId,
      listId: input.listId,
      contactIds: bulkResult.created,
    })

    // Catch contacts that already existed in the workspace but should
    // still be added to this specific list (e.g. re-importing an
    // existing CSV into a new campaign segment).
    const existingIds: string[] = []
    for (const v of valid) {
      const id = await findContactIdByIdentifier(input.workspaceId, {
        email: v.normalised.email,
        phone: v.normalised.phone,
      })
      if (id && !bulkResult.created.includes(id)) existingIds.push(id)
    }
    if (existingIds.length) {
      await addContactsToList({
        workspaceId: input.workspaceId,
        listId: input.listId,
        contactIds: existingIds,
      })
    }
  }

  // Stage 4: persist error rows + finalise the import job. We do this
  // in a single transaction so partial visibility never sticks around.
  const skippedCount =
    bulkResult.skippedDuplicates + bulkResult.skippedSuppressed + bulkResult.skippedInvalid
  const errorCount = errorRows.length
  const importedCount = bulkResult.created.length

  await db.$transaction([
    ...(errorRows.length
      ? [
        db.nativeContactImportRow.createMany({
          data: errorRows.map((r) => ({
            importId: importJob.id,
            rowNumber: r.rowNumber,
            rawData: r.rawData,
            error: r.error,
          })),
        }),
      ]
      : []),
    db.nativeContactImport.update({
      where: { id: importJob.id },
      data: {
        status: 'completed',
        importedCount,
        skippedCount,
        errorCount,
        completedAt: new Date(),
      },
    }),
  ])

  return {
    importId: importJob.id,
    totalRows: input.rows.length,
    importedCount,
    skippedCount,
    errorCount,
    status: 'completed',
  }
}

function applyMapping(
  raw: Record<string, string | null | undefined>,
  mapping: ColumnMapping,
): NormalisedContactRow {
  const out: NormalisedContactRow = {}
  const customFields: Record<string, unknown> = {}

  for (const [csvHeader, target] of Object.entries(mapping)) {
    if (target === 'skip') continue
    const value = raw[csvHeader]
    if (value === undefined || value === null || value === '') continue

    if (target.startsWith('custom:')) {
      const fieldKey = target.slice('custom:'.length)
      if (fieldKey) customFields[fieldKey] = value
      continue
    }

    switch (target as StandardContactField) {
      case 'firstName':
        out.firstName = String(value)
        break
      case 'lastName':
        out.lastName = String(value)
        break
      case 'email':
        out.email = String(value)
        break
      case 'phone':
        out.phone = String(value)
        break
      case 'tags':
        // Accept comma- or semicolon-separated tags in one cell.
        out.tags = String(value)
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
        break
      case 'source':
        out.source = String(value)
        break
    }
  }

  if (Object.keys(customFields).length > 0) {
    out.customFields = customFields
  }
  return out
}
