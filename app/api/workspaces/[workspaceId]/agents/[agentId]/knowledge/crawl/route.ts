import { NextResponse } from 'next/server'

/**
 * Removed — URL crawls now happen inside Collections at the workspace
 * level. Use POST /workspaces/[id]/knowledge/collections/[collectionId]/crawl.
 *
 * Recurring crawl schedules (CrawlSchedule) still work the same way
 * underneath — they pin to an agent for execution, but the entries
 * they produce land in that agent's connected collection rather than
 * being orphaned to an agent FK.
 */
export function POST() {
  return NextResponse.json({
    error: 'URL crawls now happen inside Collections. Use the workspace Knowledge → Collection editor.',
    code: 'AGENT_LEVEL_CRAWL_REMOVED',
  }, { status: 410 })
}
