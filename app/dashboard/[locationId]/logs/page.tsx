import Link from 'next/link'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import type { Prisma } from '@prisma/client'

type LogWithAgent = Prisma.MessageLogGetPayload<{
  include: { agent: { select: { name: true } } }
}>

export const dynamic = 'force-dynamic'

const statusColors: Record<string, string> = {
  SUCCESS: 'text-emerald-400',
  ERROR: 'text-red-400',
  SKIPPED: 'text-zinc-500',
  PENDING: 'text-yellow-400',
}

export default async function LogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { locationId } = await params
  const { page: pageParam } = await searchParams
  const page = parseInt(pageParam ?? '1')
  const limit = 25
  const skip = (page - 1) * limit

  const location = await db.location.findUnique({ where: { id: locationId } })
  if (!location) notFound()

  const [logs, total] = await Promise.all([
    db.messageLog.findMany({
      where: { locationId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.messageLog.count({ where: { locationId } }),
  ])

  const pages = Math.ceil(total / limit)

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-8">
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <span>/</span>
          <Link href={`/dashboard/${locationId}`} className="hover:text-white transition-colors font-mono">{locationId}</Link>
          <span>/</span>
          <span className="text-zinc-300">Logs</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Message Logs</h1>
          <p className="text-zinc-500 text-sm">{total} total</p>
        </div>

        {logs.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-12 text-center">
            <p className="text-zinc-400">No messages yet.</p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {logs.map((log: LogWithAgent) => (
                <div key={log.id} className="rounded-lg border border-zinc-800 px-5 py-4">
                  <div className="flex items-start justify-between gap-4 mb-2">
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span>{new Date(log.createdAt).toLocaleString()}</span>
                      <span>·</span>
                      <span className="font-mono">{log.contactId}</span>
                      {log.agent && <><span>·</span><span>{log.agent.name}</span></>}
                    </div>
                    <span className={`text-xs font-medium ${statusColors[log.status] ?? 'text-zinc-400'}`}>
                      {log.status}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 mb-1">
                    <span className="text-zinc-600">IN: </span>{log.inboundMessage}
                  </p>
                  {log.outboundReply && (
                    <p className="text-sm text-zinc-400">
                      <span className="text-zinc-600">OUT: </span>{log.outboundReply}
                    </p>
                  )}
                  {log.errorMessage && (
                    <p className="text-sm text-red-400 mt-1">{log.errorMessage}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-zinc-600">
                    {log.tokensUsed > 0 && <span>{log.tokensUsed} tokens</span>}
                    {log.actionsPerformed.length > 0 && <span>{log.actionsPerformed.join(', ')}</span>}
                  </div>
                </div>
              ))}
            </div>

            {pages > 1 && (
              <div className="flex items-center justify-between mt-6 text-sm">
                {page > 1 ? (
                  <Link href={`/dashboard/${locationId}/logs?page=${page - 1}`} className="text-zinc-400 hover:text-white transition-colors">
                    ← Previous
                  </Link>
                ) : <span />}
                <span className="text-zinc-500">Page {page} of {pages}</span>
                {page < pages ? (
                  <Link href={`/dashboard/${locationId}/logs?page=${page + 1}`} className="text-zinc-400 hover:text-white transition-colors">
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
