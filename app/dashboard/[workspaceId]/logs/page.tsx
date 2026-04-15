import Link from 'next/link'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { htmlToText, looksLikeHtml } from '@/lib/html-to-text'

type LogWithAgent = Awaited<ReturnType<typeof db.messageLog.findMany<{
  include: { agent: { select: { name: true } } }
}>>>[number]

export const dynamic = 'force-dynamic'

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  SUCCESS: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Success' },
  ERROR:   { dot: 'bg-red-400',     text: 'text-red-400',     label: 'Error' },
  SKIPPED: { dot: 'bg-zinc-500',    text: 'text-zinc-500',    label: 'Skipped' },
  PENDING: { dot: 'bg-yellow-400',  text: 'text-yellow-400',  label: 'Pending' },
}

const STATUS_TABS = ['ALL', 'SUCCESS', 'ERROR', 'SKIPPED'] as const
type StatusFilter = (typeof STATUS_TABS)[number]

/** Truncate text to maxLen chars, stripping HTML first if needed */
function cleanPreview(raw: string, maxLen = 140): string {
  const text = looksLikeHtml(raw) ? htmlToText(raw) : raw
  // Collapse whitespace
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return oneLine.slice(0, maxLen).trimEnd() + '…'
}

function relativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return `${Math.floor(diffDays / 30)}mo ago`
}

function formatTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function buildHref(
  workspaceId: string,
  params: { status?: string; page?: number }
) {
  const sp = new URLSearchParams()
  if (params.status && params.status !== 'ALL') sp.set('status', params.status)
  if (params.page && params.page > 1) sp.set('page', String(params.page))
  const qs = sp.toString()
  return `/dashboard/${workspaceId}/logs${qs ? `?${qs}` : ''}`
}

export default async function LogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ page?: string; status?: string }>
}) {
  const { workspaceId } = await params
  const { page: pageParam, status: statusParam } = await searchParams
  const page = parseInt(pageParam ?? '1')
  const limit = 25
  const skip = (page - 1) * limit

  const activeStatus: StatusFilter =
    STATUS_TABS.includes(statusParam?.toUpperCase() as StatusFilter)
      ? (statusParam!.toUpperCase() as StatusFilter)
      : 'ALL'

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })
  if (!workspace) notFound()

  // Get all location IDs for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)
  const locationFilter = locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }

  const whereClause = {
    ...locationFilter,
    ...(activeStatus !== 'ALL' ? { status: activeStatus } : {}),
  }

  const [logs, total, totalUnfiltered] = await Promise.all([
    db.messageLog.findMany({
      where: whereClause,
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.messageLog.count({ where: whereClause }),
    db.messageLog.count({ where: locationFilter }),
  ])

  const pages = Math.ceil(total / limit)

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Message Logs</h1>
            <p className="text-zinc-500 text-sm mt-1">
              {activeStatus === 'ALL'
                ? `${totalUnfiltered} total messages`
                : `${total} of ${totalUnfiltered} messages`}
            </p>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-zinc-800 pb-px">
          {STATUS_TABS.map((tab) => {
            const isActive = tab === activeStatus
            return (
              <Link
                key={tab}
                href={buildHref(workspaceId, { status: tab })}
                className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                  isActive
                    ? 'text-white'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {tab === 'ALL' ? 'All' : tab.charAt(0) + tab.slice(1).toLowerCase()}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                )}
              </Link>
            )
          })}
        </div>

        {/* Content */}
        {logs.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-12 text-center">
            {totalUnfiltered === 0 ? (
              <>
                <div className="text-zinc-600 mb-3">
                  <svg className="w-10 h-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
                  </svg>
                </div>
                <p className="text-zinc-400 mb-1">No messages logged yet.</p>
                <p className="text-zinc-600 text-sm">
                  Send a test message from the Playground to see logs here.
                </p>
              </>
            ) : (
              <p className="text-zinc-400">
                No {activeStatus.toLowerCase()} messages found.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 px-4 pb-2 text-xs text-zinc-600 font-medium">
              <span className="w-[180px]">Time</span>
              <span>Message</span>
              <span className="w-[80px] text-right">Status</span>
            </div>

            <div className="space-y-1">
              {logs.map((log: LogWithAgent) => {
                const createdAt = new Date(log.createdAt)
                const style = STATUS_STYLE[log.status] ?? STATUS_STYLE.PENDING

                return (
                  <Link
                    key={log.id}
                    href={`/dashboard/${workspaceId}/logs/${log.id}`}
                    className="grid grid-cols-[auto_1fr_auto] gap-x-4 items-start rounded-lg border border-zinc-800/60 bg-zinc-950/50 px-4 py-3 hover:border-zinc-700 hover:bg-zinc-900/30 transition-colors"
                  >
                    {/* Left: timestamp + meta */}
                    <div className="w-[180px] shrink-0">
                      <p className="text-xs text-zinc-400" title={createdAt.toISOString()}>
                        {formatTime(createdAt)}
                      </p>
                      <p className="text-[11px] text-zinc-600 mt-0.5">
                        {relativeTime(createdAt)}
                      </p>
                      {log.agent && (
                        <p className="text-[11px] text-zinc-500 mt-1 font-medium truncate">
                          {log.agent.name}
                        </p>
                      )}
                    </div>

                    {/* Center: message preview */}
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-300 leading-relaxed">
                        {cleanPreview(log.inboundMessage)}
                      </p>
                      {log.outboundReply && (
                        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
                          <span className="text-zinc-600 font-medium">Reply: </span>
                          {cleanPreview(log.outboundReply, 100)}
                        </p>
                      )}
                      {log.errorMessage && (
                        <p className="text-xs text-red-400/80 mt-1 truncate">
                          {log.errorMessage}
                        </p>
                      )}
                      {/* Meta row */}
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-zinc-600">
                        <span className="font-mono truncate max-w-[140px]" title={log.contactId}>
                          {log.contactId}
                        </span>
                        {log.tokensUsed > 0 && (
                          <span>{log.tokensUsed.toLocaleString()} tokens</span>
                        )}
                        {log.actionsPerformed.length > 0 && (
                          <span className="truncate max-w-[200px]">
                            {log.actionsPerformed.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: status */}
                    <div className="w-[80px] text-right pt-0.5">
                      <span className={`inline-flex items-center gap-1.5 text-xs ${style.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between mt-6 text-sm">
                {page > 1 ? (
                  <Link
                    href={buildHref(workspaceId, { status: activeStatus, page: page - 1 })}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    &larr; Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-zinc-500">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link
                    href={buildHref(workspaceId, { status: activeStatus, page: page + 1 })}
                    className="text-zinc-400 hover:text-white transition-colors"
                  >
                    Next &rarr;
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
