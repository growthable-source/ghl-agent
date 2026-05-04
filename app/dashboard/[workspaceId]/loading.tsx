/**
 * Per-workspace loading skeleton. Renders inside the dashboard layout
 * (sidebar + breadcrumbs already painted), so every navigation between
 * workspace pages shows this shell within tens of milliseconds while
 * the destination's server component runs its DB queries — instead of
 * a blank-screen "is the click registering?" 1-second wait.
 */
export default function WorkspaceLoading() {
  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-4">
        <div
          className="h-7 w-48 rounded animate-pulse"
          style={{ background: 'var(--surface-tertiary)' }}
        />
        <div
          className="h-4 w-72 rounded animate-pulse"
          style={{ background: 'var(--surface-tertiary)', opacity: 0.6 }}
        />
        <div className="space-y-2 pt-4">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="h-14 w-full rounded-xl animate-pulse"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                opacity: 1 - i * 0.15,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
