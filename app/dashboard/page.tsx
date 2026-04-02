import Link from 'next/link'

interface Props {
  searchParams: Promise<{ locationId?: string; connected?: string; error?: string }>
}

export default async function Dashboard({ searchParams }: Props) {
  const params = await searchParams
  const { locationId, connected, error } = params

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-lg w-full">

        {error ? (
          <>
            <div className="mb-8 inline-flex items-center gap-2 text-sm text-red-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
              Error
            </div>
            <h1 className="text-3xl font-semibold mb-2">Installation Failed</h1>
            <p className="text-zinc-400 mb-8">
              Something went wrong during the OAuth flow.
            </p>
            <div className="rounded-lg border border-red-800 bg-red-950/40 text-red-400 text-sm px-4 py-3 mb-8">
              <code>{error}</code>
            </div>
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full rounded-lg bg-white text-black font-medium text-sm h-11 px-6 hover:bg-zinc-200 transition-colors"
            >
              Try Again
            </Link>
          </>
        ) : connected && locationId ? (
          <>
            <div className="mb-8 inline-flex items-center gap-2 text-sm text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              Connected
            </div>
            <h1 className="text-3xl font-semibold mb-2">Agent is Live</h1>
            <p className="text-zinc-400 mb-10">
              The AI agent is now active on your location. It will automatically respond to inbound SMS messages.
            </p>
            <div className="space-y-3 mb-8">
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
                <span className="text-sm text-zinc-400">Location ID</span>
                <code className="text-sm text-zinc-200">{locationId}</code>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
                <span className="text-sm text-zinc-400">Status</span>
                <span className="text-sm text-emerald-400">Listening for inbound SMS</span>
              </div>
            </div>
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full rounded-lg border border-zinc-800 text-zinc-400 font-medium text-sm h-11 px-6 hover:border-zinc-600 hover:text-white transition-colors"
            >
              Back to Home
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold mb-2">Dashboard</h1>
            <p className="text-zinc-400 mb-8">No location connected yet.</p>
            <Link
              href="/"
              className="inline-flex items-center justify-center w-full rounded-lg bg-white text-black font-medium text-sm h-11 px-6 hover:bg-zinc-200 transition-colors"
            >
              Install App
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
