import { db } from '@/lib/db'

export default async function CallsPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const calls = await db.callLog.findMany({
    where: { locationId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold mb-1">Call Logs</h1>
          <p className="text-zinc-400 text-sm">Inbound and outbound voice calls handled by your agents.</p>
        </div>

        {calls.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-12 text-center">
            <p className="text-2xl mb-2">📞</p>
            <p className="text-zinc-400 text-sm">No calls yet. Configure a voice number in your agent&apos;s Voice settings.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {calls.map(call => (
              <div key={call.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{call.direction === 'inbound' ? '📲' : '📞'}</span>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{call.contactPhone || 'Unknown number'}</p>
                      <p className="text-xs text-zinc-500">{new Date(call.createdAt).toLocaleString()}</p>
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
        )}
      </div>
    </div>
  )
}
