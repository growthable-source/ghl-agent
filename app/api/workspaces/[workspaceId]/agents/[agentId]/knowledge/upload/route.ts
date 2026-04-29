import { NextResponse } from 'next/server'

/**
 * Removed in favor of collection-scoped uploads. File uploads now go
 * to POST /workspaces/[id]/knowledge/collections/[collectionId]/upload.
 *
 * Operators pick a collection (or create a new one) before uploading,
 * then connect the collection to whichever agents should see the file.
 */
export function POST() {
  return NextResponse.json({
    error: 'Uploads now happen inside Collections. Use POST /workspaces/[id]/knowledge/collections/[collectionId]/upload after creating or selecting a collection.',
    code: 'AGENT_LEVEL_UPLOAD_REMOVED',
  }, { status: 410 })
}
