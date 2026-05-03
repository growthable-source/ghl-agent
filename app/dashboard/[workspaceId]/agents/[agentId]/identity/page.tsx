'use client'

/**
 * Identity Overview — landing for the Identity hub.
 *
 * Surfaces every setting that shapes who the agent IS:
 *   • Persona     — name, formality, response length, emoji policy, languages
 *   • Voice       — phone, voice provider/model when configured
 *
 * Read-only summary; saves happen on the dedicated editors.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OverviewSection, OverviewRow, EmptyHint, Tag } from '@/components/dashboard/AgentOverview'

interface AgentIdentity {
  name: string
  agentPersonaName: string | null
  responseLength: string | null
  formalityLevel: string | null
  useEmojis: boolean
  languages: string[] | null
  systemPrompt: string | null
  instructions: string | null
}

interface VapiConfig {
  isActive: boolean
  phoneNumber: string | null
  ttsProvider: string | null
  ttsVoiceId: string | null
}

const FORMALITY_LABEL: Record<string, string> = {
  casual: 'Casual',
  neutral: 'Neutral',
  formal: 'Formal',
}
const LENGTH_LABEL: Record<string, string> = {
  short: 'Short — under 2 sentences',
  medium: 'Medium — 2–4 sentences',
  long: 'Long — full paragraphs',
}

export default function IdentityOverviewPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [agent, setAgent] = useState<AgentIdentity | null>(null)
  const [voice, setVoice] = useState<VapiConfig | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.json())
        .then(d => setAgent({
          name: d.agent?.name ?? '',
          agentPersonaName: d.agent?.agentPersonaName ?? null,
          responseLength: d.agent?.responseLength ?? null,
          formalityLevel: d.agent?.formalityLevel ?? null,
          useEmojis: !!d.agent?.useEmojis,
          languages: d.agent?.languages ?? null,
          systemPrompt: d.agent?.systemPrompt ?? null,
          instructions: d.agent?.instructions ?? null,
        }))
        .catch(() => setAgent(null)),
      // Voice config lives on a separate endpoint and is optional.
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`)
        .then(r => r.ok ? r.json() : null)
        .then(d => setVoice(d ? {
          isActive: !!d.config?.isActive,
          phoneNumber: d.config?.phoneNumber ?? null,
          ttsProvider: d.config?.ttsProvider ?? null,
          ttsVoiceId: d.config?.ttsVoiceId ?? null,
        } : { isActive: false, phoneNumber: null, ttsProvider: null, ttsVoiceId: null }))
        .catch(() => setVoice({ isActive: false, phoneNumber: null, ttsProvider: null, ttsVoiceId: null })),
    ])
  }, [workspaceId, agentId])

  if (agent === null || voice === null) {
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

  // ── Derived ────────────────────────────────────────────────────────────
  const promptChars = (agent.systemPrompt?.length ?? 0) + (agent.instructions?.length ?? 0)
  const promptHasContent = promptChars > 0
  const personaConfigured =
    !!agent.agentPersonaName ||
    !!agent.formalityLevel ||
    !!agent.responseLength ||
    (agent.languages?.length ?? 0) > 0

  return (
    <div className="p-8 max-w-3xl space-y-5">
      {/* Persona */}
      <OverviewSection
        title="Persona"
        subtitle="Voice, tone, and personality the agent uses on every channel."
        pill={
          personaConfigured
            ? { tone: 'live', label: 'Configured' }
            : { tone: 'idle', label: 'Default' }
        }
        editHref={`${base}/persona`}
      >
        <div className="space-y-1.5">
          <OverviewRow
            label="Persona name"
            value={agent.agentPersonaName || <span style={{ color: 'var(--text-tertiary)' }}>(uses agent name)</span>}
            muted={!agent.agentPersonaName}
          />
          <OverviewRow
            label="Formality"
            value={agent.formalityLevel ? (FORMALITY_LABEL[agent.formalityLevel] ?? agent.formalityLevel) : 'Neutral'}
          />
          <OverviewRow
            label="Response length"
            value={agent.responseLength ? (LENGTH_LABEL[agent.responseLength] ?? agent.responseLength) : 'Medium — 2–4 sentences'}
          />
          <OverviewRow label="Emojis" value={agent.useEmojis ? 'On' : 'Off'} />
          <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
            <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Languages</span>
            <span className="flex flex-wrap gap-1 justify-end">
              {(agent.languages?.length ?? 0) > 0
                ? agent.languages!.map(l => <Tag key={l}>{l}</Tag>)
                : <Tag>en</Tag>
              }
            </span>
          </div>
        </div>
      </OverviewSection>

      {/* Prompt */}
      <OverviewSection
        title="System prompt"
        subtitle="The base instructions the model sees on every turn. Knowledge, persona blocks, and channel context are appended automatically."
        pill={
          promptHasContent
            ? { tone: 'live', label: `${promptChars.toLocaleString()} chars` }
            : { tone: 'warn', label: 'Empty' }
        }
        editHref={`${base}`}
        editLabel="Edit prompt"
      >
        {!promptHasContent ? (
          <EmptyHint>No prompt set yet — the agent has no guidance on what it should do or how it should behave.</EmptyHint>
        ) : (
          <p
            className="text-xs leading-relaxed line-clamp-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            {(agent.systemPrompt || agent.instructions || '').slice(0, 320)}
            {(agent.systemPrompt || agent.instructions || '').length > 320 && '…'}
          </p>
        )}
      </OverviewSection>

      {/* Voice */}
      <OverviewSection
        title="Voice"
        subtitle="Phone-call configuration. Optional — the agent works on text channels regardless."
        pill={
          voice.isActive
            ? { tone: 'live', label: 'Live' }
            : { tone: 'idle', label: 'Off' }
        }
        editHref={`${base}/voice`}
      >
        {voice.isActive ? (
          <div className="space-y-1.5">
            <OverviewRow label="Phone number" value={voice.phoneNumber || '—'} muted={!voice.phoneNumber} />
            {voice.ttsProvider && <OverviewRow label="Voice provider" value={voice.ttsProvider} />}
            {voice.ttsVoiceId && <OverviewRow label="Voice" value={voice.ttsVoiceId} />}
          </div>
        ) : (
          <EmptyHint>Voice isn't configured. The agent only handles text channels right now.</EmptyHint>
        )}
      </OverviewSection>
    </div>
  )
}
