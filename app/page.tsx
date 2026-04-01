export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        <div className="mb-8">
          <span className="inline-flex items-center gap-2 text-sm text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            Online
          </span>
        </div>

        <h1 className="text-3xl font-semibold mb-2">GHL AI Agent</h1>
        <p className="text-zinc-400 mb-10">
          AI-powered SMS agent for GoHighLevel. Handles inbound messages, updates contacts, and moves pipeline stages automatically.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
            <span className="text-sm text-zinc-400">Webhook endpoint</span>
            <code className="text-sm text-zinc-200">/api/webhooks/events</code>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
            <span className="text-sm text-zinc-400">OAuth callback</span>
            <code className="text-sm text-zinc-200">/api/auth/callback</code>
          </div>
        </div>
      </div>
    </div>
  )
}
