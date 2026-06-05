/**
 * Voice agent — Calls tab.
 *
 * Per-agent view over CallLog. Same shape as the workspace-wide /calls
 * page, but filtered to this one agent. Server component so the agent
 * filter is enforced at the DB layer (CallLog has an @@index on
 * (agentId, createdAt) so this is cheap).
 */
import Link from 'next/link'
import { db } from '@/lib/db'

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime()
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

function formatDuration(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}m${s ? ` ${s}s` : ''}`
}

function statusColour(status: string): string {
  const s = status.toLowerCase()
  if (s.includes('success') || s.includes('completed') || s.includes('ended')) return 'var(--accent-emerald)'
  if (s.includes('failed') || s.includes('error')) return '#ef4444'
  return 'var(--text-secondary)'
}

export default async function VoiceAgentCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; agentId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { workspaceId, agentId } = await params
  const { page: pageParam } = await searchParams
  const page = parseInt(pageParam ?? '1')
  const limit = 25
  const skip = (page - 1) * limit

  // Cross-check the agent belongs to this workspace before reading
  // its call log. Saves us from a misconfigured URL exposing another
  // workspace's data.
  const agent = await db.agent.findFirst({
    where: { id: agentId, location: { workspaceId } },
    select: { id: true },
  })
  if (!agent) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Agent not found in this workspace.</p>
      </div>
    )
  }

  const where = { agentId }
  const [calls, total] = await Promise.all([
    db.callLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    db.callLog.count({ where }),
  ])
  const pages = Math.ceil(total / limit)

  return (
    <div className="px-8 py-8 max-w-5xl mx-auto w-full">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Calls
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Every inbound + outbound call this agent has handled.
          </p>
        </div>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{total} total</p>
      </div>

      {calls.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm mb-2" style={{ color: 'var(--text-primary)' }}>No calls yet.</p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Place a test call from the Overview tab to see activity here.
          </p>
        </div>
      ) : (
        <>
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {calls.map((c, i) => (
              <Link
                key={c.id}
                href={`/dashboard/${workspaceId}/calls/${c.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:opacity-90"
                style={i > 0 ? { borderTop: '1px solid var(--border)' } : undefined}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                    style={{ background: 'var(--surface-secondary)' }}
                    aria-hidden
                  >
                    {c.direction === 'outbound' ? '📤' : '📥'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {c.contactPhone || 'Unknown number'}
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDuration(c.durationSecs)} · {relativeTime(c.createdAt)}
                      {c.triggerSource ? ` · ${c.triggerSource}` : ''}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-medium" style={{ color: statusColour(c.status) }}>
                  {c.status}
                </span>
              </Link>
            ))}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <Link
                href={`?page=${Math.max(1, page - 1)}`}
                aria-disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                ← Newer
              </Link>
              <span>Page {page} of {pages}</span>
              <Link
                href={`?page=${Math.min(pages, page + 1)}`}
                aria-disabled={page >= pages}
                className="px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                Older →
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
