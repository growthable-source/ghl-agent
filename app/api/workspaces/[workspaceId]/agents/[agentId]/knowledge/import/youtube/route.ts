import { NextResponse } from 'next/server'

/**
 * Removed — YouTube imports now happen inside Collections at the
 * workspace level. The collection editor exposes the same YouTube
 * transcript import flow.
 */
export function POST() {
  return NextResponse.json({
    error: 'YouTube imports now happen inside Collections. Use the workspace Knowledge → Collection editor.',
    code: 'AGENT_LEVEL_IMPORT_REMOVED',
  }, { status: 410 })
}
