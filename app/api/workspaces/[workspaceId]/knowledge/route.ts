import { NextResponse } from 'next/server'

/**
 * Legacy "flat list of entries" endpoint. Replaced by Collections —
 * the workspace surface is now a list of named bundles, not a flat
 * list of items. Use:
 *
 *   GET  /workspaces/[id]/knowledge/collections
 *   POST /workspaces/[id]/knowledge/collections
 *
 * The dashboard moved over already; this stub is here only to give a
 * clear hint to anyone calling the old path from a script.
 */
export function GET() {
  return NextResponse.json({
    error: 'The flat knowledge list was replaced by Collections. Use GET /workspaces/[id]/knowledge/collections.',
    code: 'KNOWLEDGE_LIST_REPLACED_BY_COLLECTIONS',
  }, { status: 410 })
}

export function POST() {
  return NextResponse.json({
    error: 'Knowledge entries are now created inside a Collection. Use POST /workspaces/[id]/knowledge/collections/[collectionId]/entries.',
    code: 'KNOWLEDGE_CREATE_REPLACED_BY_COLLECTIONS',
  }, { status: 410 })
}
