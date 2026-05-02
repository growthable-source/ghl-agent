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

  // Get all location IDs for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)
  const locationFilter = locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }

  const [calls, total] = await Promise.all([
    db.callLog.findMany({
      where: locationFilter,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.callLog.count({ where: locationFilter }),
  ])

  const pages = Math.ceil(total / limit)

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Call Logs</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Inbound and outbound voice calls handled by your agents.</p>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{total} total</p>
        </div>

        {calls.length === 0 ? (
          <div className="rounded-xl p-12 text-center" style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              No calls yet. Set up a phone number in your agent&apos;s Voice tab to start receiving calls.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {calls.map(call => (
                <div
                  key={call.id}
                  className="rounded-xl p-4"
                  style={{
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    borderColor: 'var(--border)',
                    backgroundColor: 'var(--surface)',
                  }}
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={
                          call.direction === 'inbound'
                            ? { backgroundColor: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' }
                            : { backgroundColor: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                        }
                      >
                        {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                      </span>
                      <div>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                          {call.contactPhone || 'No caller ID'}
                        </p>
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          {new Date(call.createdAt).toLocaleString()}
                          <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{relativeTime(new Date(call.createdAt))}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {call.durationSecs != null && (
                        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{Math.floor(call.durationSecs / 60)}m {call.durationSecs % 60}s</span>
                      )}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={
                          call.status === 'completed'
                            ? { backgroundColor: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                            : { backgroundColor: 'var(--accent-red-bg)', color: 'var(--accent-red)' }
                        }
                      >
                        {call.status}
                      </span>
                    </div>
                  </div>
                  {call.summary && (
                    <p
                      className="text-xs mb-2 rounded-lg p-2"
                      style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--surface-secondary)' }}
                    >
                      {call.summary}
                    </p>
                  )}
                  {call.transcript && (
                    <details className="mt-2">
                      <summary
                        className="text-xs cursor-pointer transition-colors hover:opacity-80"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        View transcript
                      </summary>
                      <pre
                        className="mt-2 text-xs whitespace-pre-wrap rounded-lg p-3 max-h-64 overflow-y-auto font-sans"
                        style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--surface-secondary)' }}
                      >
                        {call.transcript}
                      </pre>
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
                  <Link
                    href={`/dashboard/${workspaceId}/calls?page=${page - 1}`}
                    className="transition-colors hover:opacity-80"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    ← Previous
                  </Link>
                ) : <span />}
                <span style={{ color: 'var(--text-tertiary)' }}>Page {page} of {pages}</span>
                {page < pages ? (
                  <Link
                    href={`/dashboard/${workspaceId}/calls?page=${page + 1}`}
                    className="transition-colors hover:opacity-80"
                    style={{ color: 'var(--text-secondary)' }}
                  >
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
