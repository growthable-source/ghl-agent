'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'

interface Widget {
  id: string
  name: string
  publicKey: string
  primaryColor: string
  logoUrl: string | null
  title: string
  subtitle: string
  welcomeMessage: string
  position: string
  requireEmail: boolean
  askForNameEmail: boolean
  voiceEnabled: boolean
  voiceAgentId: string | null
  defaultAgentId: string | null
  allowedDomains: string[]
  isActive: boolean
}

export default function WidgetEditorPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const widgetId = params.widgetId as string

  const [widget, setWidget] = useState<Widget | null>(null)
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)

  const fetchWidget = useCallback(async () => {
    const [w, a] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/widgets/${widgetId}`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/agents`).then(r => r.json()),
    ])
    if (w.widget) setWidget(w.widget)
    setAgents(a.agents || [])
    setLoading(false)
  }, [workspaceId, widgetId])

  useEffect(() => { fetchWidget() }, [fetchWidget])

  function update<K extends keyof Widget>(key: K, val: Widget[K]) {
    if (!widget) return
    setWidget({ ...widget, [key]: val })
    setDirty(true)
  }

  async function save() {
    if (!widget) return
    setSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/widgets/${widgetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(widget),
      })
      setDirty(false)
    } finally { setSaving(false) }
  }

  async function deleteWidget() {
    if (!confirm('Delete this widget? All conversations will be removed.')) return
    await fetch(`/api/workspaces/${workspaceId}/widgets/${widgetId}`, { method: 'DELETE' })
    router.push(`/dashboard/${workspaceId}/widgets`)
  }

  function copyInstall() {
    if (!widget) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const snippet = `<script src="${origin}/widget.js" data-widget-id="${widget.id}" data-public-key="${widget.publicKey}" async></script>`
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>
  if (!widget) return <div className="p-8 text-zinc-500">Widget not found</div>

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const snippet = `<script src="${origin}/widget.js" data-widget-id="${widget.id}" data-public-key="${widget.publicKey}" async></script>`

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/widgets`} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">
          ← Back to widgets
        </Link>

        <div className="flex items-start justify-between mb-8">
          <div>
            <input
              type="text"
              value={widget.name}
              onChange={e => update('name', e.target.value)}
              className="text-2xl font-bold text-white bg-transparent border-0 p-0 focus:outline-none focus:ring-0"
            />
            <p className="text-xs text-zinc-500 font-mono mt-1">{widget.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <button
                type="button"
                onClick={() => update('isActive', !widget.isActive)}
                className="relative inline-flex h-5 w-9 items-center rounded-full"
                style={{ background: widget.isActive ? '#22c55e' : '#3f3f46' }}
              >
                <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
                  style={{ transform: widget.isActive ? 'translateX(20px)' : 'translateX(4px)' }} />
              </button>
              <span className="text-xs text-zinc-400">{widget.isActive ? 'Live' : 'Paused'}</span>
            </label>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white transition-colors disabled:opacity-40"
              style={{ background: dirty ? '#fa4d2e' : '#3f3f46' }}
            >
              {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>

        {/* Install snippet */}
        <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 mb-6">
          <p className="text-sm font-semibold text-white mb-2">📦 Install snippet</p>
          <p className="text-xs text-zinc-500 mb-3">Paste this into the <code className="text-orange-400">{'<head>'}</code> or before <code className="text-orange-400">{'</body>'}</code> of any site.</p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 text-[11px] text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 font-mono overflow-x-auto whitespace-nowrap">
              {snippet}
            </code>
            <button onClick={copyInstall}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors flex-shrink-0"
              style={{ background: copied ? '#22c55e' : '#fa4d2e' }}
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Form */}
          <div className="space-y-4">
            <Section title="Routing">
              <Field label="Default agent">
                <select value={widget.defaultAgentId || ''} onChange={e => update('defaultAgentId', e.target.value || null as any)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                  <option value="">— use channel routing —</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Allowed domains" helper="One per line. Use * for any, or *.example.com for subdomains. Leave blank to allow all.">
                <textarea
                  value={widget.allowedDomains.join('\n')}
                  onChange={e => update('allowedDomains', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
                  rows={3}
                  placeholder="example.com&#10;*.myapp.com"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono"
                />
              </Field>
            </Section>

            <Section title="Appearance">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Primary color">
                  <div className="flex gap-2">
                    <input type="color" value={widget.primaryColor} onChange={e => update('primaryColor', e.target.value)}
                      className="w-10 h-10 bg-transparent border border-zinc-700 rounded cursor-pointer" />
                    <input type="text" value={widget.primaryColor} onChange={e => update('primaryColor', e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono" />
                  </div>
                </Field>
                <Field label="Position">
                  <select value={widget.position} onChange={e => update('position', e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                  </select>
                </Field>
              </div>
              <Field label="Title">
                <input type="text" value={widget.title} onChange={e => update('title', e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
              </Field>
              <Field label="Subtitle">
                <input type="text" value={widget.subtitle} onChange={e => update('subtitle', e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
              </Field>
              <Field label="Welcome message">
                <MergeFieldTextarea value={widget.welcomeMessage}
                  onChange={e => update('welcomeMessage', e.target.value)}
                  onValueChange={v => update('welcomeMessage', v)}
                  placeholder="Hi {{contact.first_name|there}}, how can we help?"
                  rows={2}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded pl-3 pr-3 pt-8 pb-2 text-sm text-white" />
              </Field>
              <Field label="Logo URL (optional)">
                <input type="url" value={widget.logoUrl || ''} onChange={e => update('logoUrl', e.target.value || null as any)}
                  placeholder="https://…"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
              </Field>
            </Section>

            <Section title="Visitor identity">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={widget.requireEmail} onChange={e => update('requireEmail', e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-orange-500" />
                <div>
                  <p className="text-sm text-white">Require email before chat starts</p>
                  <p className="text-xs text-zinc-500">Blocks the chat until the visitor provides their email.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={widget.askForNameEmail} onChange={e => update('askForNameEmail', e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-orange-500" />
                <div>
                  <p className="text-sm text-white">Ask for name + email when helpful</p>
                  <p className="text-xs text-zinc-500">Agent can ask during conversation if needed (e.g. before booking).</p>
                </div>
              </label>
            </Section>

            <Section title="Voice">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={widget.voiceEnabled} onChange={e => update('voiceEnabled', e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-orange-500" />
                <div>
                  <p className="text-sm text-white">Enable voice calls (WebRTC)</p>
                  <p className="text-xs text-zinc-500">Visitors can click a mic button to talk to the AI voice agent.</p>
                </div>
              </label>
              {widget.voiceEnabled && (
                <Field label="Voice agent (optional — defaults to text agent)">
                  <select value={widget.voiceAgentId || ''} onChange={e => update('voiceAgentId', e.target.value || null as any)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                    <option value="">— same agent as text —</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </Field>
              )}
            </Section>

            <button onClick={deleteWidget} className="text-xs text-red-400 hover:text-red-300 transition-colors">
              Delete widget
            </button>
          </div>

          {/* Preview */}
          <div className="sticky top-8 self-start">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Preview</p>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden" style={{ height: 520 }}>
              <WidgetPreview widget={widget} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 space-y-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {children}
    </div>
  )
}

function Field({ label, children, helper }: { label: string; children: React.ReactNode; helper?: string }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      {children}
      {helper && <p className="text-[10px] text-zinc-500 mt-1">{helper}</p>}
    </div>
  )
}

function WidgetPreview({ widget }: { widget: Widget }) {
  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100 text-xs">
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-zinc-800" style={{ background: `linear-gradient(135deg, ${widget.primaryColor}25, ${widget.primaryColor}10)` }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: widget.primaryColor, color: '#fff' }}>
          {widget.title.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{widget.title}</p>
          <p className="text-[10px] text-zinc-400 truncate">{widget.subtitle}</p>
        </div>
      </div>
      <div className="flex-1 p-3 space-y-2 overflow-y-auto">
        <div className="flex justify-start">
          <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tl-sm bg-zinc-800 text-xs">
            {widget.welcomeMessage}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tr-sm text-white text-xs"
            style={{ background: widget.primaryColor }}>
            Hi! What times are you available for a demo?
          </div>
        </div>
      </div>
      <div className="p-2 border-t border-zinc-800">
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1.5">
          <span className="text-[10px] text-zinc-600 flex-1">Type a message…</span>
          <div className="w-6 h-6 rounded-full" style={{ background: widget.primaryColor }} />
        </div>
      </div>
    </div>
  )
}
