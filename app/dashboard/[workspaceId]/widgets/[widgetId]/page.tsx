'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'

interface Widget {
  id: string
  name: string
  publicKey: string
  type: 'chat' | 'click_to_call'
  slug: string | null
  embedMode: 'floating' | 'inline'
  primaryColor: string
  logoUrl: string | null
  title: string
  subtitle: string
  welcomeMessage: string
  position: string
  buttonLabel: string
  buttonShape: 'pill' | 'rounded' | 'square'
  buttonSize: 'sm' | 'md' | 'lg'
  buttonIcon: 'phone' | 'mic' | 'none'
  buttonTextColor: string
  hostedPageHeadline: string | null
  hostedPageSubtext: string | null
  requireEmail: boolean
  askForNameEmail: boolean
  voiceEnabled: boolean
  voiceAgentId: string | null
  defaultAgentId: string | null
  allowedDomains: string[]
  isActive: boolean
}

type CopyKey = 'embed' | 'hostedUrl' | 'emailSig' | 'inline'

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [copied, setCopied] = useState<CopyKey | null>(null)

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
    setSaveError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets/${widgetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(widget),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(data.error || 'Failed to save')
        return
      }
      if (data.widget) setWidget(data.widget)
      setDirty(false)
    } finally { setSaving(false) }
  }

  async function deleteWidget() {
    if (!confirm('Delete this widget? All conversations will be removed.')) return
    await fetch(`/api/workspaces/${workspaceId}/widgets/${widgetId}`, { method: 'DELETE' })
    router.push(`/dashboard/${workspaceId}/widgets`)
  }

  function copy(key: CopyKey, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>
  if (!widget) return <div className="p-8 text-zinc-500">Widget not found</div>

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const isCallType = widget.type === 'click_to_call'
  const isInline = widget.embedMode === 'inline'

  const scriptSnippet = `<script src="${origin}/widget.js" data-widget-id="${widget.id}" data-public-key="${widget.publicKey}" async></script>`
  const inlineSnippet = `<div id="voxility-call"></div>\n<script src="${origin}/widget.js" data-widget-id="${widget.id}" data-public-key="${widget.publicKey}" data-mount="#voxility-call" async></script>`
  const hostedUrl = widget.slug ? `${origin}/c/${widget.slug}` : ''
  const emailSigSnippet = hostedUrl
    ? `<a href="${hostedUrl}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:${widget.primaryColor};color:${widget.buttonTextColor};font:600 13px -apple-system,Segoe UI,sans-serif;text-decoration:none">📞 ${widget.buttonLabel}</a>`
    : ''

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
            <p className="text-xs text-zinc-500 font-mono mt-1">
              {widget.id}
              <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-sans uppercase tracking-wide">
                {isCallType ? 'click-to-call' : 'chat'}
              </span>
            </p>
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

        {saveError && (
          <div className="p-3 mb-4 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">
            {saveError}
          </div>
        )}

        {/* Install / share section */}
        <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">📦 Install</p>
            {isCallType && (
              <div className="inline-flex rounded-lg border border-zinc-800 p-0.5">
                <button
                  onClick={() => update('embedMode', 'floating')}
                  className={`text-[11px] px-3 py-1 rounded ${!isInline ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
                >Floating button</button>
                <button
                  onClick={() => update('embedMode', 'inline')}
                  className={`text-[11px] px-3 py-1 rounded ${isInline ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
                >Inline (in-page)</button>
              </div>
            )}
          </div>

          <SnippetRow
            label={isInline ? 'Inline embed' : 'Script tag'}
            help={isInline
              ? 'Place the div where you want the button to appear, and the script anywhere on the page.'
              : <>Paste into the <code className="text-orange-400">{'<head>'}</code> or before <code className="text-orange-400">{'</body>'}</code> of any site.</>}
            value={isInline ? inlineSnippet : scriptSnippet}
            copied={copied === (isInline ? 'inline' : 'embed')}
            onCopy={() => copy(isInline ? 'inline' : 'embed', isInline ? inlineSnippet : scriptSnippet)}
          />

          <div className="border-t border-zinc-800 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-white">🌐 Hosted call page</p>
              <span className="text-[10px] text-zinc-500">Share as a link — no website needed</span>
            </div>
            <div className="flex items-stretch gap-2 mb-2">
              <div className="flex items-stretch flex-1 bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
                <span className="text-[11px] text-zinc-500 px-3 self-center font-mono">{origin}/c/</span>
                <input
                  type="text"
                  value={widget.slug || ''}
                  onChange={e => update('slug', e.target.value as any)}
                  placeholder="your-brand"
                  className="flex-1 bg-transparent text-[11px] text-zinc-300 font-mono py-2 pr-3 focus:outline-none"
                />
              </div>
              <button
                onClick={() => hostedUrl && copy('hostedUrl', hostedUrl)}
                disabled={!hostedUrl}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-30"
                style={{ background: copied === 'hostedUrl' ? '#22c55e' : '#fa4d2e' }}
              >
                {copied === 'hostedUrl' ? '✓ Copied' : 'Copy link'}
              </button>
            </div>
            {hostedUrl && (
              <a href={hostedUrl} target="_blank" rel="noopener" className="text-[11px] text-orange-400 hover:text-orange-300">
                Open hosted page ↗
              </a>
            )}
          </div>

          {hostedUrl && (
            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs font-semibold text-white mb-2">✉️ Email signature snippet</p>
              <p className="text-[11px] text-zinc-500 mb-2">Paste this HTML into your email signature editor (Gmail, Outlook, Superhuman).</p>
              <SnippetRow
                value={emailSigSnippet}
                copied={copied === 'emailSig'}
                onCopy={() => copy('emailSig', emailSigSnippet)}
                preview={
                  <a href={hostedUrl} target="_blank" rel="noopener"
                    style={{ display: 'inline-block', padding: '8px 14px', borderRadius: 999, background: widget.primaryColor, color: widget.buttonTextColor, fontWeight: 600, fontSize: 13, textDecoration: 'none' }}>
                    📞 {widget.buttonLabel}
                  </a>
                }
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Form */}
          <div className="space-y-4">
            <Section title="Routing">
              <Field label={isCallType ? 'Voice agent' : 'Default agent'}>
                <select value={widget.defaultAgentId || ''} onChange={e => update('defaultAgentId', e.target.value || null as any)}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                  <option value="">— select an agent —</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Allowed domains" helper="One per line. Use *.example.com for subdomains. Leave blank to allow all (the hosted page works regardless).">
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
                {(!isCallType || !isInline) && (
                  <Field label="Position">
                    <select value={widget.position} onChange={e => update('position', e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                      <option value="bottom-right">Bottom right</option>
                      <option value="bottom-left">Bottom left</option>
                    </select>
                  </Field>
                )}
              </div>

              {!isCallType && (
                <>
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
                </>
              )}

              <Field label="Logo URL (optional)">
                <input type="url" value={widget.logoUrl || ''} onChange={e => update('logoUrl', e.target.value || null as any)}
                  placeholder="https://…"
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
              </Field>
            </Section>

            {isCallType && (
              <Section title="Button styling">
                <Field label="Button label">
                  <input type="text" value={widget.buttonLabel} onChange={e => update('buttonLabel', e.target.value)}
                    placeholder="Talk to us"
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Shape">
                    <select value={widget.buttonShape} onChange={e => update('buttonShape', e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                      <option value="pill">Pill</option>
                      <option value="rounded">Rounded</option>
                      <option value="square">Square</option>
                    </select>
                  </Field>
                  <Field label="Size">
                    <select value={widget.buttonSize} onChange={e => update('buttonSize', e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                      <option value="sm">Small</option>
                      <option value="md">Medium</option>
                      <option value="lg">Large</option>
                    </select>
                  </Field>
                  <Field label="Icon">
                    <select value={widget.buttonIcon} onChange={e => update('buttonIcon', e.target.value as any)}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
                      <option value="phone">Phone</option>
                      <option value="mic">Mic</option>
                      <option value="none">None</option>
                    </select>
                  </Field>
                </div>
                <Field label="Text color">
                  <div className="flex gap-2">
                    <input type="color" value={widget.buttonTextColor} onChange={e => update('buttonTextColor', e.target.value)}
                      className="w-10 h-10 bg-transparent border border-zinc-700 rounded cursor-pointer" />
                    <input type="text" value={widget.buttonTextColor} onChange={e => update('buttonTextColor', e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono" />
                  </div>
                </Field>
              </Section>
            )}

            <Section title="Hosted page">
              <Field label="Headline (optional)" helper="Shown on the hosted call page above the button.">
                <input type="text" value={widget.hostedPageHeadline || ''} onChange={e => update('hostedPageHeadline', e.target.value || null as any)}
                  placeholder={isCallType ? 'Talk to our team in 30 seconds' : 'Chat with us'}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
              </Field>
              <Field label="Subtext (optional)">
                <input type="text" value={widget.hostedPageSubtext || ''} onChange={e => update('hostedPageSubtext', e.target.value || null as any)}
                  placeholder="No phone tag. Pick up and we&#39;ll handle it."
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
              </Field>
            </Section>

            {!isCallType && (
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
            )}

            {!isCallType && (
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
            )}

            <button onClick={deleteWidget} className="text-xs text-red-400 hover:text-red-300 transition-colors">
              Delete widget
            </button>
          </div>

          {/* Preview */}
          <div className="sticky top-8 self-start">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Preview</p>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden" style={{ height: 520 }}>
              {isCallType ? <CallButtonPreview widget={widget} /> : <ChatPreview widget={widget} />}
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

function SnippetRow({
  label, help, value, copied, onCopy, preview,
}: {
  label?: string
  help?: React.ReactNode
  value: string
  copied: boolean
  onCopy: () => void
  preview?: React.ReactNode
}) {
  return (
    <div>
      {label && <p className="text-xs font-semibold text-zinc-200 mb-1">{label}</p>}
      {help && <p className="text-xs text-zinc-500 mb-2">{help}</p>}
      <div className="flex items-stretch gap-2">
        <code className="flex-1 text-[11px] text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 font-mono overflow-x-auto whitespace-pre">
          {value}
        </code>
        <button onClick={onCopy}
          className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors flex-shrink-0"
          style={{ background: copied ? '#22c55e' : '#fa4d2e' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {preview && (
        <div className="mt-3 p-4 rounded-lg bg-white flex items-center justify-center">
          {preview}
        </div>
      )}
    </div>
  )
}

function ChatPreview({ widget }: { widget: Widget }) {
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

function CallButtonPreview({ widget }: { widget: Widget }) {
  const radii: Record<string, string> = { pill: '999px', rounded: '12px', square: '4px' }
  const pads: Record<string, string> = { sm: '8px 14px', md: '12px 20px', lg: '16px 28px' }
  const fonts: Record<string, string> = { sm: '13px', md: '15px', lg: '17px' }
  const iconSize: Record<string, number> = { sm: 14, md: 16, lg: 20 }
  const isInline = widget.embedMode === 'inline'

  const button = (
    <button
      type="button"
      style={{
        background: widget.primaryColor,
        color: widget.buttonTextColor,
        borderRadius: radii[widget.buttonShape],
        padding: pads[widget.buttonSize],
        fontSize: fonts[widget.buttonSize],
        fontWeight: 600,
        border: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
      }}
    >
      {widget.buttonIcon === 'phone' && (
        <svg width={iconSize[widget.buttonSize]} height={iconSize[widget.buttonSize]} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      )}
      {widget.buttonIcon === 'mic' && (
        <svg width={iconSize[widget.buttonSize]} height={iconSize[widget.buttonSize]} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
      )}
      {widget.buttonLabel}
    </button>
  )

  if (isInline) {
    return (
      <div className="h-full bg-white p-6 overflow-auto">
        <div className="max-w-md mx-auto">
          <div className="h-3 w-32 bg-zinc-200 rounded mb-2" />
          <div className="h-3 w-48 bg-zinc-200 rounded mb-6" />
          <div className="h-2 w-full bg-zinc-100 rounded mb-1.5" />
          <div className="h-2 w-5/6 bg-zinc-100 rounded mb-1.5" />
          <div className="h-2 w-4/6 bg-zinc-100 rounded mb-4" />
          <div className="my-4">{button}</div>
          <div className="h-2 w-full bg-zinc-100 rounded mb-1.5" />
          <div className="h-2 w-3/4 bg-zinc-100 rounded" />
        </div>
      </div>
    )
  }
  return (
    <div className="h-full bg-zinc-100 relative">
      <div className="p-6">
        <div className="h-3 w-24 bg-zinc-300 rounded mb-2" />
        <div className="h-3 w-40 bg-zinc-300 rounded" />
      </div>
      <div className={`absolute bottom-5 ${widget.position === 'bottom-left' ? 'left-5' : 'right-5'}`}>
        {button}
      </div>
    </div>
  )
}
