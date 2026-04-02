import Link from 'next/link'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const locations = await db.location.findMany({
    include: {
      _count: { select: { agents: true, messageLogs: true } },
    },
    orderBy: { installedAt: 'desc' },
  })

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Dashboard</h1>
            <p className="text-zinc-400 text-sm mt-1">{locations.length} connected location{locations.length !== 1 ? 's' : ''}</p>
          </div>
          <Link href="/" className="text-sm text-zinc-400 hover:text-white transition-colors">
            + Install New Location
          </Link>
        </div>

        {locations.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-12 text-center">
            <p className="text-zinc-400 mb-4">No locations connected yet.</p>
            <Link href="/" className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-5 hover:bg-zinc-200 transition-colors">
              Install on GoHighLevel
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {locations.map((loc) => (
              <Link
                key={loc.id}
                href={`/dashboard/${loc.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-800 px-5 py-4 hover:border-zinc-600 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{loc.id}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    Installed {new Date(loc.installedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm font-medium">{loc._count.agents}</p>
                    <p className="text-zinc-500 text-xs">agents</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{loc._count.messageLogs}</p>
                    <p className="text-zinc-500 text-xs">messages</p>
                  </div>
                  <span className="text-zinc-600">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
