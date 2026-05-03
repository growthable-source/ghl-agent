'use client'

/**
 * Knowledge Overview — landing for the Knowledge hub.
 *
 * Surfaces every system that controls what the agent KNOWS and what it
 * pulls out of conversations:
 *   • Knowledge entries  — facts the agent can cite
 *   • Listening rules    — categories the agent watches for and remembers
 *   • Qualifying questions — info the agent has to gather
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OverviewSection, OverviewRow, EmptyHint } from '@/components/dashboard/AgentOverview'

interface KnowledgeEntry { id: string; title: string | null; updatedAt?: string }
interface ListeningRule { id: string; category: string; isActive: boolean }
interface QualifyingQ { id: string; question: string; isActive: boolean; required: boolean }

export default function KnowledgeOverviewPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [knowledge, setKnowledge] = useState<KnowledgeEntry[] | null>(null)
  const [listening, setListening] = useState<ListeningRule[] | null>(null)
  const [qualifying, setQualifying] = useState<QualifyingQ[] | null>(null)
  const [qualifyingStyle, setQualifyingStyle] = useState<string>('strict')

  useEffect(() => {
    Promise.all([
      // Knowledge entries are returned hydrated on the agent endpoint.
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.json())
        .then(d => {
          setKnowledge(d.agent?.knowledgeEntries ?? [])
          setQualifyingStyle(d.agent?.qualifyingStyle ?? 'strict')
        })
        .catch(() => setKnowledge([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/listening-rules`)
        .then(r => r.json())
        .then(d => setListening(d.rules ?? []))
        .catch(() => setListening([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/qualifying-questions`)
        .then(r => r.json())
        .then(d => setQualifying(d.questions ?? []))
        .catch(() => setQualifying([])),
    ])
  }, [workspaceId, agentId])

  if (knowledge === null || listening === null || qualifying === null) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 rounded-xl animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  const activeListening = listening.filter(l => l.isActive)
  const activeQualifying = qualifying.filter(q => q.isActive)
  const requiredQualifying = activeQualifying.filter(q => q.required)

  return (
    <div className="p-8 max-w-3xl space-y-5">
      {/* Knowledge entries */}
      <OverviewSection
        title="Knowledge"
        subtitle="Facts the agent reads from when answering. Most relevant entries are included on every turn."
        pill={
          knowledge.length > 0
            ? { tone: 'live', label: `${knowledge.length} ${knowledge.length === 1 ? 'entry' : 'entries'}` }
            : { tone: 'warn', label: 'Empty' }
        }
        editHref={`${base}/knowledge`}
      >
        {knowledge.length === 0 ? (
          <EmptyHint>No knowledge entries — the agent only has its system prompt to work from.</EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {knowledge.slice(0, 5).map(k => (
              <li
                key={k.id}
                className="text-xs truncate"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span style={{ color: 'var(--text-tertiary)' }}>•</span>{' '}
                {k.title || <span style={{ color: 'var(--text-tertiary)' }}>(untitled)</span>}
              </li>
            ))}
            {knowledge.length > 5 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{knowledge.length - 5} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>

      {/* Listening */}
      <OverviewSection
        title="Listening"
        subtitle="Categories the agent watches for in every conversation. When something matches, the agent files it into its private notes about the contact."
        pill={
          activeListening.length > 0
            ? { tone: 'info', label: `${activeListening.length} active` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/listening`}
      >
        {activeListening.length === 0 ? (
          <EmptyHint>No listening categories — the agent won't capture life context unless you add some.</EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {activeListening.slice(0, 5).map(l => (
              <li key={l.id} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>•</span> {l.category}
              </li>
            ))}
            {activeListening.length > 5 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{activeListening.length - 5} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>

      {/* Qualifying */}
      <OverviewSection
        title="Qualifying questions"
        subtitle="Information the agent has to collect before it can hand off. Required questions block handover until answered."
        pill={
          activeQualifying.length > 0
            ? { tone: 'info', label: `${activeQualifying.length} active` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/qualifying`}
      >
        <div className="space-y-1.5 mb-3">
          <OverviewRow
            label="Style"
            value={qualifyingStyle === 'natural' ? 'Natural — work them in conversationally' : 'Strict — ask up front'}
          />
          <OverviewRow
            label="Required"
            value={`${requiredQualifying.length} of ${activeQualifying.length}`}
          />
        </div>
        {activeQualifying.length === 0 ? (
          <EmptyHint>No qualifying questions — the agent will hand off the moment it has nothing to add.</EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {activeQualifying.slice(0, 4).map(q => (
              <li key={q.id} className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>•</span> {q.question}
                {q.required && (
                  <span className="ml-1.5 text-[10px]" style={{ color: 'var(--accent-amber)' }}>required</span>
                )}
              </li>
            ))}
            {activeQualifying.length > 4 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{activeQualifying.length - 4} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>
    </div>
  )
}
