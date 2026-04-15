import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { htmlToText, looksLikeHtml } from '@/lib/html-to-text'

export const dynamic = 'force-dynamic'

const statusColors: Record<string, string> = {
  SUCCESS: 'text-emerald-400 bg-emerald-900/20 border-emerald-800',
  ERROR: 'text-red-400 bg-red-900/20 border-red-800',
  SKIPPED: 'text-zinc-400 bg-zinc-800/20 border-zinc-700',
  PENDING: 'text-yellow-400 bg-yellow-900/20 border-yellow-800',
}

/** Clean message for display — strip HTML if present */
function cleanMessage(raw: string): string {
  if (!raw) return ''
  return looksLikeHtml(raw) ? htmlToText(raw) : raw
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
  const createdAt = new Date(log.createdAt)

  return (
    <div className="p-8 max-w-3xl">
      {/* Back link */}
      <Link
        href={`/dashboard/${workspaceId}/logs`}
        className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors mb-6 inline-block"
      >
        &larr; Back to logs
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-xs font-medium px-2.5 py-1 rounded border ${statusColors[log.status] ?? 'text-zinc-400'}`}>
              {log.status}
            </span>
            {log.agent && (
              <Link href={`/dashboard/${workspaceId}/agents/${log.agent.id}`} className="text-xs text-zinc-400 hover:text-white transition-colors font-medium">
                {log.agent.name}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-zinc-600">
            <span>{createdAt.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</span>
            {log.tokensUsed > 0 && <span>{log.tokensUsed.toLocaleString()} tokens</span>}
            {log.actionsPerformed.length > 0 && (
              <span>{log.actionsPerformed.join(', ')}</span>
            )}
          </div>
          <p className="text-[11px] text-zinc-700 font-mono mt-1">
            Contact: {log.contactId}
          </p>
        </div>
      </div>

      {/* Conversation */}
      <div className="space-y-4 mb-8">
        {/* Inbound */}
        <div className="flex justify-start">
          <div className="max-w-lg rounded-2xl rounded-tl-sm bg-zinc-800 px-4 py-3">
            <p className="text-sm text-white whitespace-pre-wrap leading-relaxed">{cleanMessage(log.inboundMessage)}</p>
            <p className="text-[11px] text-zinc-500 mt-2">Contact</p>
          </div>
        </div>

        {/* Tool calls */}
        {toolTrace.length > 0 && (
          <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 mx-4">
            <p className="px-4 py-2 text-xs text-zinc-500 font-medium">
              Tool Calls ({toolTrace.length})
            </p>
            {toolTrace.map((t: any, i: number) => (
              <details key={i} className="group">
                <summary className="flex items-center justify-between px-4 py-2.5 cursor-pointer list-none">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">{t.tool}</span>
                    <span className="text-xs text-zinc-600">{t.durationMs}ms</span>
                  </div>
                  <span className="text-zinc-600 text-xs group-open:rotate-180 transition-transform">&#9660;</span>
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
            <div className="max-w-lg rounded-2xl rounded-tr-sm bg-white px-4 py-3">
              <p className="text-sm text-black whitespace-pre-wrap leading-relaxed">{cleanMessage(log.outboundReply)}</p>
              <p className="text-[11px] text-zinc-500 mt-2 text-right">{log.agent?.name ?? 'Agent'}</p>
            </div>
          </div>
        )}

        {log.errorMessage && (
          <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3">
            <p className="text-xs font-medium text-red-400 mb-1">Error</p>
            <p className="text-xs text-red-400/80">{log.errorMessage}</p>
          </div>
        )}
      </div>
    </div>
  )
}
