import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const statusColors: Record<string, string> = {
  SUCCESS: 'text-emerald-400 bg-emerald-900/20 border-emerald-800',
  ERROR: 'text-red-400 bg-red-900/20 border-red-800',
  SKIPPED: 'text-zinc-400 bg-zinc-800/20 border-zinc-700',
  PENDING: 'text-yellow-400 bg-yellow-900/20 border-yellow-800',
}

export default async function LogDetailPage({
  params,
}: {
  params: Promise<{ workspaceId: string; logId: string }>
}) {
  const { workspaceId, logId } = await params

  const log = await db.messageLog.findUnique({
    where: { id: logId },
    include: { agent: { select: { name: true, id: true } } },
  })

  if (!log) notFound()

  const toolTrace = (log.toolCallTrace as any[]) ?? []

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${statusColors[log.status] ?? 'text-zinc-400'}`}>
              {log.status}
            </span>
            {log.agent && (
              <Link href={`/dashboard/${workspaceId}/agents/${log.agent.id}`} className="text-xs text-zinc-500 hover:text-white transition-colors">
                {log.agent.name}
              </Link>
            )}
          </div>
          <p className="text-xs text-zinc-600">{new Date(log.createdAt).toLocaleString()} · {log.tokensUsed} tokens</p>
        </div>
      </div>

      {/* Conversation */}
      <div className="space-y-4 mb-8">
        {/* Inbound */}
        <div className="flex justify-start">
          <div className="max-w-sm rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3">
            <p className="text-sm text-white">{log.inboundMessage}</p>
            <p className="text-xs text-zinc-500 mt-1">Contact · {log.contactId}</p>
          </div>
        </div>

        {/* Tool calls */}
        {toolTrace.length > 0 && (
          <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 mx-4">
            <p className="px-4 py-2 text-xs text-zinc-500 font-medium">Tool Calls</p>
            {toolTrace.map((t: any, i: number) => (
              <details key={i} className="group">
                <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer list-none">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">{t.tool}</span>
                    <span className="text-xs text-zinc-600">{t.durationMs}ms</span>
                  </div>
                  <span className="text-zinc-600 text-xs group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="px-4 pb-3 space-y-2">
                  <div>
                    <p className="text-xs text-zinc-600 mb-1">Input</p>
                    <pre className="text-xs bg-zinc-900 rounded p-2 overflow-x-auto text-zinc-300">{JSON.stringify(t.input, null, 2)}</pre>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-600 mb-1">Output</p>
                    <pre className="text-xs bg-zinc-900 rounded p-2 overflow-x-auto text-zinc-300 max-h-32 overflow-y-auto">{t.output}</pre>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}

        {/* Outbound reply */}
        {log.outboundReply && (
          <div className="flex justify-end">
            <div className="max-w-sm rounded-2xl rounded-tr-sm bg-white px-4 py-3">
              <p className="text-sm text-black">{log.outboundReply}</p>
              <p className="text-xs text-zinc-500 mt-1 text-right">{log.agent?.name ?? 'Agent'}</p>
            </div>
          </div>
        )}

        {log.errorMessage && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3">
            <p className="text-xs text-red-400">{log.errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  )
}
