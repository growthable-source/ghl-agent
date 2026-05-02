'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Topic {
  slug: string
  title: string
  summary: string
  chips?: string[]
}

const TOPICS: Topic[] = [
  {
    slug: 'merge-fields',
    title: 'Merge fields',
    summary: 'Insert live contact data into pre-written templates — follow-ups, triggers, voice, widget, fallback messages.',
    chips: ['{{contact.first_name}}', '{{custom.field_key}}', 'Fallbacks'],
  },
]

export default function HelpIndexPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Help &amp; reference</h1>
      <p className="text-sm mt-1 mb-8" style={{ color: 'var(--text-tertiary)' }}>
        Short reference guides for the parts of the agent builder that do a lot in a small space.
      </p>

      <div className="space-y-2">
        {TOPICS.map(t => (
          <Link
            key={t.slug}
            href={`/dashboard/${workspaceId}/help/${t.slug}`}
            className="block rounded-xl p-5 transition-colors"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.title}</h2>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{t.summary}</p>
                {t.chips && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {t.chips.map(c => (
                      <span
                        key={c}
                        className="text-[10px] font-mono rounded px-2 py-0.5"
                        style={{
                          background: 'var(--surface-secondary)',
                          border: '1px solid var(--border)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="mt-1" style={{ color: 'var(--text-muted)' }}>→</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
        More topics will appear here as new features land. If you can&apos;t find what you&apos;re looking for, use the Feedback link in the sidebar.
      </p>
    </div>
  )
}
