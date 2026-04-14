'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  SmsIcon, WhatsAppIcon, FacebookIcon, InstagramIcon,
  GoogleIcon, LiveChatIcon, EmailIcon, PhoneIcon,
} from '@/components/icons/brand-icons'

interface ChannelDeployment {
  id: string
  channel: string
  isActive: boolean
  config: any
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

  const [deployments, setDeployments] = useState<ChannelDeployment[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`)
      .then(r => r.json())
      .then(({ deployments: d }) => setDeployments(d ?? []))
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

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

    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`, {
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
                active ? 'bg-zinc-800/50 ' + ch.color : 'bg-zinc-800 text-zinc-500'
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
            <PhoneIcon className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-zinc-300">Voice (Phone Calls)</p>
            <p className="text-xs text-zinc-500 mt-0.5">Voice is configured separately with its own phone number and voice settings.</p>
          </div>
          <Link
            href={`/dashboard/${workspaceId}/agents/${agentId}/voice`}
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
