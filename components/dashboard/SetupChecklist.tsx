'use client'

/**
 * First-run setup checklist.
 *
 * The "login and it makes sense" surface. A brand-new user used to be
 * bounced straight into the agent-creation form with no context, or
 * dropped onto an analytics dashboard full of zeroes. This shows the
 * 4–5 concrete steps from empty workspace to a working agent, each a
 * direct link, with live ticks as they complete. It disappears on its
 * own once everything's done, so it never nags an established
 * workspace.
 *
 * State comes from /setup-status (the same definition the co-pilot
 * uses), so "done" here always agrees with the rest of the product.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface SetupStatus {
  steps: {
    createAgent: boolean
    addKnowledge: boolean
    connectCrm: boolean
    deployChannel: boolean
    activateAgent: boolean
  }
  done: number
  total: number
  complete: boolean
  workspaceName: string
}

export default function SetupChecklist({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Honour a manual dismiss so a power user who deliberately skipped
    // a step (e.g. browser-only, no CRM) isn't nagged forever.
    setDismissed(localStorage.getItem(`voxility:setup-dismissed:${workspaceId}`) === '1')
    fetch(`/api/workspaces/${workspaceId}/setup-status`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setStatus(d))
      .catch(() => setStatus(null))
  }, [workspaceId])

  if (!status || status.complete || dismissed) return null

  const items: Array<{ key: keyof SetupStatus['steps']; label: string; help: string; href: string }> = [
    {
      key: 'createAgent',
      label: 'Create your first agent',
      help: 'An agent answers your customers automatically across chat, SMS, email and voice.',
      href: `/dashboard/${workspaceId}/agents/new`,
    },
    {
      key: 'connectCrm',
      label: 'Connect your CRM',
      help: 'Link your CRM so the agent can read contacts and book appointments. Skip if you only need website chat.',
      href: `/dashboard/${workspaceId}/integrations`,
    },
    {
      key: 'addKnowledge',
      label: 'Teach it about your business',
      help: 'Paste a link or drop a file on the Knowledge page — the agent learns it and answers from it.',
      href: `/dashboard/${workspaceId}/knowledge`,
    },
    {
      key: 'deployChannel',
      label: 'Put it live on a channel',
      help: 'Turn on a channel (website chat is fastest) so real people can reach your agent.',
      href: `/dashboard/${workspaceId}/channels`,
    },
    {
      key: 'activateAgent',
      label: 'Switch the agent on',
      help: 'Flip the agent to active so it starts replying.',
      href: `/dashboard/${workspaceId}/agents`,
    },
  ]

  const pct = Math.round((status.done / status.total) * 100)
  // The next undone step is the one we nudge toward.
  const nextKey = items.find(i => !status.steps[i.key])?.key

  function dismiss() {
    localStorage.setItem(`voxility:setup-dismissed:${workspaceId}`, '1')
    setDismissed(true)
  }

  return (
    <div
      className="rounded-xl border p-5 mb-6"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            Let’s get {status.workspaceName} set up
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {status.done} of {status.total} done — finish these and your AI is live.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-xs shrink-0 hover:underline"
          style={{ color: 'var(--text-tertiary)' }}
        >
          Dismiss
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full mb-4 overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--accent-primary)' }} />
      </div>

      <div className="space-y-1.5">
        {items.map(item => {
          const done = status.steps[item.key]
          const isNext = item.key === nextKey
          return (
            <Link
              key={item.key}
              href={item.href}
              className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-zinc-900/40"
              style={isNext ? { background: 'var(--accent-primary-bg)' } : undefined}
            >
              <span
                className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                style={{
                  background: done ? 'var(--accent-emerald)' : 'transparent',
                  border: done ? 'none' : '1.5px solid var(--border-secondary)',
                  color: '#fff',
                }}
              >
                {done ? '✓' : ''}
              </span>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{
                    color: done ? 'var(--text-tertiary)' : 'var(--text-primary)',
                    textDecoration: done ? 'line-through' : undefined,
                  }}
                >
                  {item.label}
                </p>
                {!done && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {item.help}
                  </p>
                )}
              </div>
              {isNext && (
                <span
                  className="shrink-0 text-xs font-semibold self-center"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  Start →
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
