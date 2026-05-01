'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  SmsIcon, WhatsAppIcon, FacebookIcon, InstagramIcon,
  GoogleIcon, LiveChatIcon, EmailIcon, PhoneIcon,
} from '@/components/icons/brand-icons'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

interface ChannelDeployment {
  id: string
  channel: string
  isActive: boolean
  config: any
}

interface DeployState {
  deployments: ChannelDeployment[]
}

const CHANNELS = [
  { key: 'SMS', label: 'SMS', desc: 'Text messages via GoHighLevel', icon: <SmsIcon className="w-5 h-5" />, color: 'text-blue-400' },
  { key: 'WhatsApp', label: 'WhatsApp', desc: 'WhatsApp Business via GoHighLevel', icon: <WhatsAppIcon className="w-5 h-5" />, color: 'text-[#25D366]' },
  { key: 'FB', label: 'Facebook Messenger', desc: 'Facebook page messages', icon: <FacebookIcon className="w-5 h-5" />, color: 'text-[#1877F2]' },
  { key: 'IG', label: 'Instagram DMs', desc: 'Instagram direct messages', icon: <InstagramIcon className="w-5 h-5" />, color: 'text-[#E4405F]' },
  { key: 'GMB', label: 'Google Business', desc: 'Google Business Profile messages', icon: <GoogleIcon className="w-5 h-5" />, color: 'text-white' },
  { key: 'Live_Chat', label: 'Live Chat', desc: 'Website chat widget', icon: <LiveChatIcon className="w-5 h-5" />, color: 'text-violet-400' },
  { key: 'Email', label: 'Email', desc: 'Email conversations via GoHighLevel', icon: <EmailIcon className="w-5 h-5" />, color: 'text-amber-400' },
]

export default function DeployPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<DeployState | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`)
      .then(r => r.json())
      .then(({ deployments: d }) => setInitial({ deployments: d ?? [] }))
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<DeployState>({
    initial,
    onSave: async (d) => {
      const channels = CHANNELS.map(ch => {
        const dep = d.deployments.find(x => x.channel === ch.key)
        return {
          channel: ch.key,
          isActive: dep?.isActive ?? false,
          config: dep?.config ?? null,
        }
      })
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  function isChannelActive(channel: string): boolean {
    const d = draft?.deployments?.find(dep => dep.channel === channel)
    return d ? d.isActive : false
  }

  function toggleChannel(channel: string) {
    const list = draft?.deployments ?? []
    const existing = list.find(d => d.channel === channel)
    const next = existing
      ? list.map(d => d.channel === channel ? { ...d, isActive: !d.isActive } : d)
      : [...list, { id: '', channel, isActive: true, config: null }]
    set({ deployments: next })
  }

  const activeCount = draft?.deployments?.filter(d => d.isActive).length ?? 0

  // Guard must also check draft.deployments — useDirtyForm initialises its
  // internal draft to `{}` before the sync-with-initial effect runs, so there
  // is a one-render window where initial is truthy but draft still has no
  // deployments array. Without this, the channel map would call .find on
  // undefined and crash the whole page (Chrome surfaces that as "This page
  // couldn't load" since there's no error boundary here).
  if (loading || !initial || !draft?.deployments) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Deploy this agent to one or more messaging channels. The agent uses the same brain, knowledge, and tools on every channel it's deployed to.
      </p>

      {/* Active deployment count */}
      <div className="flex items-center gap-2 mb-6">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border"
          style={
            activeCount > 0
              ? {
                  background: 'var(--accent-emerald-bg)',
                  color: 'var(--accent-emerald)',
                  borderColor: 'var(--accent-emerald)',
                }
              : {
                  background: 'var(--surface-secondary)',
                  color: 'var(--text-tertiary)',
                  borderColor: 'var(--border)',
                }
          }
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: activeCount > 0 ? 'var(--accent-emerald)' : 'var(--text-muted)' }}
          />
          {activeCount > 0 ? `Live on ${activeCount} channel${activeCount > 1 ? 's' : ''}` : 'Not deployed'}
        </span>
      </div>

      {/* Channel grid */}
      <div className="space-y-3 mb-8">
        {CHANNELS.map(ch => {
          const active = isChannelActive(ch.key)
          return (
            <div
              key={ch.key}
              onClick={() => toggleChannel(ch.key)}
              className="flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-all"
              style={
                active
                  ? {
                      borderColor: 'var(--accent-emerald)',
                      background: 'var(--accent-emerald-bg)',
                    }
                  : {
                      borderColor: 'var(--border)',
                      background: 'var(--surface)',
                    }
              }
            >
              <div
                className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${active ? ch.color : ''}`}
                style={{
                  background: 'var(--surface-secondary)',
                  color: active ? undefined : 'var(--text-tertiary)',
                }}
              >
                {ch.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p
                  className="text-sm font-medium"
                  style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                >
                  {ch.label}
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{ch.desc}</p>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); toggleChannel(ch.key) }}
                className="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors"
                style={{ background: active ? 'var(--accent-emerald)' : 'var(--border-secondary)' }}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${
                    active ? 'translate-x-5' : 'translate-x-0'
                  }`}
                  style={{ background: 'var(--btn-primary-text)' }}
                />
              </button>
            </div>
          )
        })}
      </div>

      {/* Voice callout */}
      <div
        className="rounded-xl border p-4 mb-6"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
          >
            <PhoneIcon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Voice (Phone Calls)</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Voice is configured separately with its own phone number and voice settings.</p>
          </div>
          <Link
            href={`/dashboard/${workspaceId}/agents/${agentId}/voice`}
            className="text-xs transition-colors shrink-0 hover:opacity-80"
            style={{ color: 'var(--accent-primary)' }}
          >
            Configure Voice
          </Link>
        </div>
      </div>

      {/* Info box */}
      <div
        className="rounded-xl border p-4 mb-6"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>How it works:</span> When a message arrives on any enabled channel,
          the agent automatically responds using the same knowledge base, tools, and persona. Routing rules are applied across
          all channels. If no channels are enabled, the agent defaults to responding on all channels for backward compatibility.
        </p>
      </div>

      <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
    </div>
  )
}
