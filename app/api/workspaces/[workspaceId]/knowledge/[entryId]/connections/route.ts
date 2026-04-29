import { NextResponse } from 'next/server'

/**
 * Removed — connections now live at the *collection* level. To change
 * which agents see a given entry, move the entry to a different
 * collection (or change the collection's agent connections):
 *
 *   PUT /workspaces/[id]/knowledge/collections/[collectionId]/connections
 */
export function PUT() {
  return NextResponse.json({
    error: 'Per-entry connections were replaced by per-collection connections. Use PUT /workspaces/[id]/knowledge/collections/[collectionId]/connections.',
    code: 'ENTRY_CONNECTIONS_REMOVED',
  }, { status: 410 })
}
