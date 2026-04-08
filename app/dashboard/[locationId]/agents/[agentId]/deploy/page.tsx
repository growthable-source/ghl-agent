'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface ChannelDeployment {
  id: string
  channel: string
  isActive: boolean
  config: any
}

const CHANNELS = [
  {
    key: 'SMS',
    label: 'SMS',
    desc: 'Text messages via GoHighLevel',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
      </svg>
    ),
  },
  {
    key: 'WhatsApp',
    label: 'WhatsApp',
    desc: 'WhatsApp Business via GoHighLevel',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
      </svg>
    ),
  },
  {
    key: 'FB',
    label: 'Facebook Messenger',
    desc: 'Facebook page messages',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.04C6.5 2.04 2 6.13 2 11.06c0 2.83 1.4 5.36 3.59 7.01V22l3.73-2.05c1 .28 2.05.42 3.14.42h.28c5.22-.12 9.26-4.2 9.26-9.06 0-5.18-4.5-9.27-10-9.27zm1.07 12.47l-2.54-2.72-4.97 2.72 5.47-5.81 2.6 2.72 4.92-2.72-5.48 5.81z"/>
      </svg>
    ),
  },
  {
    key: 'IG',
    label: 'Instagram DMs',
    desc: 'Instagram direct messages',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
      </svg>
    ),
  },
  {
    key: 'GMB',
    label: 'Google Business',
    desc: 'Google Business Profile messages',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
  },
  {
    key: 'Live_Chat',
    label: 'Live Chat',
    desc: 'Website chat widget',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
  },
  {
    key: 'Email',
    label: 'Email',
    desc: 'Email conversations via GoHighLevel',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
]

export default function DeployPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [deployments, setDeployments] = useState<ChannelDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}/channels`)
      .then(r => r.json())
      .then(({ deployments: d }) => setDeployments(d ?? []))
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  function isChannelActive(channel: string): boolean {
    const d = deployments.find(dep => dep.channel === channel)
    return d ? d.isActive : false
  }

  function toggleChannel(channel: string) {
    setDeployments(prev => {
      const existing = prev.find(d => d.channel === channel)
      if (existing) {
        return prev.map(d => d.channel === channel ? { ...d, isActive: !d.isActive } : d)
      }
      return [...prev, { id: '', channel, isActive: true, config: null }]
    })
  }

  async function save() {
    setSaving(true)
    const channels = CHANNELS.map(ch => {
      const dep = deployments.find(d => d.channel === ch.key)
      return {
        channel: ch.key,
        isActive: dep?.isActive ?? false,
        config: dep?.config ?? null,
      }
    })

    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/channels`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channels }),
    })
    const { deployments: updated } = await res.json()
    setDeployments(updated)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const activeCount = deployments.filter(d => d.isActive).length

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading...</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm text-zinc-400 mb-6">
        Deploy this agent to one or more messaging channels. The agent uses the same brain, knowledge, and tools on every channel it's deployed to.
      </p>

      {/* Active deployment count */}
      <div className="flex items-center gap-2 mb-6">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
          activeCount > 0
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-zinc-800 text-zinc-500 border border-zinc-700'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${activeCount > 0 ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
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
              className={`flex items-center gap-4 rounded-xl border p-4 cursor-pointer transition-all ${
                active
                  ? 'border-emerald-500/40 bg-emerald-500/5'
                  : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
              }`}
            >
              <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'
              }`}>
                {ch.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>
                  {ch.label}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">{ch.desc}</p>
              </div>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); toggleChannel(ch.key) }}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  active ? 'bg-emerald-500' : 'bg-zinc-700'
                }`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  active ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Voice callout */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm text-zinc-300">Voice (Phone Calls)</p>
            <p className="text-xs text-zinc-500 mt-0.5">Voice is configured separately with its own phone number and voice settings.</p>
          </div>
          <Link
            href={`/dashboard/${locationId}/agents/${agentId}/voice`}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors shrink-0"
          >
            Configure Voice
          </Link>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 mb-6">
        <p className="text-xs text-zinc-500 leading-relaxed">
          <span className="text-zinc-400 font-medium">How it works:</span> When a message arrives on any enabled channel,
          the agent automatically responds using the same knowledge base, tools, and persona. Routing rules are applied across
          all channels. If no channels are enabled, the agent defaults to responding on all channels for backward compatibility.
        </p>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save Deployment'}
      </button>
    </div>
  )
}
