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
      <h1 className="text-xl font-semibold text-zinc-100">Help &amp; reference</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-8">
        Short reference guides for the parts of the agent builder that do a lot in a small space.
      </p>

      <div className="space-y-2">
        {TOPICS.map(t => (
          <Link
            key={t.slug}
            href={`/dashboard/${workspaceId}/help/${t.slug}`}
            className="block rounded-xl border border-zinc-800 bg-zinc-950 hover:border-zinc-600 p-5 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-medium text-zinc-100">{t.title}</h2>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{t.summary}</p>
                {t.chips && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {t.chips.map(c => (
                      <span key={c} className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 text-zinc-400 rounded px-2 py-0.5">
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-zinc-600 mt-1">→</span>
            </div>
          </Link>
        ))}
      </div>

      <p className="text-xs text-zinc-600 mt-8">
        More topics will appear here as new features land. If you can&apos;t find what you&apos;re looking for, use the Feedback link in the sidebar.
      </p>
    </div>
  )
}
