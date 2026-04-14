import Link from 'next/link'
import { db } from '@/lib/db'

function relativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 30) return `${diffDays}d ago`
  return `${Math.floor(diffDays / 30)}mo ago`
}

export default async function CallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { workspaceId } = await params
  const { page: pageParam } = await searchParams
  const page = parseInt(pageParam ?? '1')
  const limit = 25
  const skip = (page - 1) * limit

  const [calls, total] = await Promise.all([
    db.callLog.findMany({
      where: { locationId: workspaceId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.callLog.count({ where: { locationId: workspaceId } }),
  ])

  const pages = Math.ceil(total / limit)

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold mb-1">Call Logs</h1>
            <p className="text-zinc-400 text-sm">Inbound and outbound voice calls handled by your agents.</p>
          </div>
          <p className="text-zinc-500 text-sm">{total} total</p>
        </div>

        {calls.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-12 text-center">
            <p className="text-zinc-400 text-sm">
              No calls yet. Set up a phone number in your agent&apos;s Voice tab to start receiving calls.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {calls.map(call => (
                <div key={call.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        call.direction === 'inbound'
                          ? 'bg-blue-900/30 text-blue-400'
                          : 'bg-violet-900/30 text-violet-400'
                      }`}>
                        {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-zinc-200">
                          {call.contactPhone || 'No caller ID'}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {new Date(call.createdAt).toLocaleString()}
                          <span className="ml-2 text-zinc-600">{relativeTime(new Date(call.createdAt))}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {call.durationSecs != null && (
                        <span className="text-xs text-zinc-500">{Math.floor(call.durationSecs / 60)}m {call.durationSecs % 60}s</span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        call.status === 'completed' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
                      }`}>
                        {call.status}
                      </span>
                    </div>
                  </div>
                  {call.summary && (
                    <p className="text-xs text-zinc-400 mb-2 bg-zinc-900 rounded-lg p-2">{call.summary}</p>
                  )}
                  {call.transcript && (
                    <details className="mt-2">
                      <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors">View transcript</summary>
                      <pre className="mt-2 text-xs text-zinc-400 whitespace-pre-wrap bg-zinc-900 rounded-lg p-3 max-h-64 overflow-y-auto font-sans">{call.transcript}</pre>
                    </details>
                  )}
                  {call.recordingUrl && (
                    <div className="mt-2">
                      <audio controls src={call.recordingUrl} className="w-full h-8 mt-1" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between mt-6 text-sm">
                {page > 1 ? (
                  <Link href={`/dashboard/${workspaceId}/calls?page=${page - 1}`} className="text-zinc-400 hover:text-white transition-colors">
                    ← Previous
                  </Link>
                ) : <span />}
                <span className="text-zinc-500">Page {page} of {pages}</span>
                {page < pages ? (
                  <Link href={`/dashboard/${workspaceId}/calls?page=${page + 1}`} className="text-zinc-400 hover:text-white transition-colors">
                    Next →
                  </Link>
                ) : <span />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
