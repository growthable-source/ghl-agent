import { NextResponse } from 'next/server'

/**
 * Removed — Notion imports now happen inside Collections at the
 * workspace level. The collection editor exposes the same Notion
 * import flow; the resulting entry attaches to whichever agents
 * connect to that collection.
 */
export function POST() {
  return NextResponse.json({
    error: 'Notion imports now happen inside Collections. Use the workspace Knowledge → Collection editor.',
    code: 'AGENT_LEVEL_IMPORT_REMOVED',
  }, { status: 410 })
}
