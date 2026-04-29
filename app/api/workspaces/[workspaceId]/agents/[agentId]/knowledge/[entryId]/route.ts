import { NextResponse } from 'next/server'

/**
 * Removed — entries are managed inside their parent collection.
 *
 * To edit:   PATCH /workspaces/[id]/knowledge/collections/[cid]/entries/[entryId]
 * To delete: DELETE same path (removes the entry from the collection,
 *            which cascades to every agent connected to that collection).
 *
 * To "remove an entry from a single agent" — disconnect the
 * collection from that agent via PUT /workspaces/[id]/agents/[aid]/collections.
 */
export function PATCH() {
  return NextResponse.json({
    error: 'Entries are now edited under their collection. Use PATCH /workspaces/[id]/knowledge/collections/[cid]/entries/[entryId].',
    code: 'AGENT_LEVEL_EDIT_REMOVED',
  }, { status: 410 })
}

export function DELETE() {
  return NextResponse.json({
    error: 'Entries are now deleted from their collection. To remove an entry from a single agent, disconnect the collection from that agent via PUT /workspaces/[id]/agents/[aid]/collections.',
    code: 'AGENT_LEVEL_DELETE_REMOVED',
  }, { status: 410 })
}
