'use client'

/**
 * Co-Pilot agent editor.
 *
 * Edit a named co-pilot: persona, the procedure steps it walks, its
 * knowledge scope, and — the differentiator — UPLOAD RECORDINGS of
 * real human calls that it learns from. Each recording is transcribed
 * + screen-walkthrough-extracted in the background, then distilled
 * into the agent's playbook (shown read-only, editable as text). A
 * "Start a session" link runs a live call AS this agent.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Recording {
  id: string
  originalFilename: string
  status: string
  error: string | null
  hasWalkthrough: boolean
  createdAt: string
}
interface AgentDetail {
  id: string
  name: string
  type: string
  openingLine: string | null
  collectInfo: string | null
  publicKey: string | null
  published: boolean
  persona: string | null
  steps: string[]
  timeboxMinutes: number
  knowledgeDomainIds: string[]
  playbook: string | null
  recordings: Recording[]
}

export default function CopilotAgentEditor() {
  const params = useParams<{ workspaceId: string; agentId: string }>()
  const workspaceId = params?.workspaceId
  const agentId = params?.agentId

  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [name, setName] = useState('')
  const [persona, setPersona] = useState('')
  const [openingLine, setOpeningLine] = useState('')
  const [collectInfo, setCollectInfo] = useState('')
  const [stepsText, setStepsText] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [playbook, setPlaybook] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}`)
    if (!res.ok) return
    const body = await res.json()
    const a: AgentDetail = body.agent
    setAgent(a)
    setName(a.name)
    setPersona(a.persona ?? '')
    setOpeningLine(a.openingLine ?? '')
    setCollectInfo(a.collectInfo ?? '')
    setStepsText(a.steps.join('\n'))
    setMinutes(String(a.timeboxMinutes))
    setPlaybook(a.playbook ?? '')
  }, [workspaceId, agentId])

  useEffect(() => {
    void load()
  }, [load])

  // Poll while any recording is still processing so the playbook +
  // statuses update without a manual refresh.
  const anyProcessing = (agent?.recordings ?? []).some(r => r.status === 'queued' || r.status === 'processing')
  useEffect(() => {
    if (!anyProcessing) return
    const i = setInterval(() => void load(), 5000)
    return () => clearInterval(i)
  }, [anyProcessing, load])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          persona,
          openingLine,
          collectInfo,
          steps: stepsText.split('\n').map(s => s.trim()).filter(Boolean),
          timeboxMinutes: Number(minutes) || 30,
          playbook,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }, [workspaceId, agentId, name, persona, openingLine, collectInfo, stepsText, minutes, playbook])

  const upload = useCallback(
    async (file: File) => {
      setUploading(true)
      setUploadPct(0)
      setUploadError(null)
      try {
        // Upload the file DIRECTLY to Vercel Blob from the browser —
        // videos are far bigger than the ~4.5MB serverless body limit,
        // so they can't be POSTed through our function. The token route
        // authorises it; we then register the resulting key.
        const { upload: blobUpload } = await import('@vercel/blob/client')
        const safe = file.name.replace(/[^\w.\- ]+/g, '_')
        const pathname = `copilot-recordings/${workspaceId}/${crypto.randomUUID()}-${safe}`
        const blob = await blobUpload(pathname, file, {
          access: 'public',
          handleUploadUrl: `/api/workspaces/${workspaceId}/copilot/agents/${agentId}/recordings/upload-url`,
          onUploadProgress: ({ percentage }) => setUploadPct(Math.round(percentage)),
        })

        const res = await fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}/recordings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storageKey: blob.pathname, originalFilename: file.name }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setUploadError(body.error || 'Could not register the upload.')
          return
        }
        void load()
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed.')
      } finally {
        setUploading(false)
        setUploadPct(null)
      }
    },
    [workspaceId, agentId, load],
  )

  const [relearning, setRelearning] = useState(false)
  const relearn = useCallback(async () => {
    setRelearning(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}/relearn`, { method: 'POST' })
      if (res.ok) {
        // Give the background distill a moment, then reload to show the
        // refreshed steps + playbook.
        setTimeout(() => void load(), 4000)
      }
    } finally {
      setTimeout(() => setRelearning(false), 4000)
    }
  }, [workspaceId, agentId, load])

  const togglePublish = useCallback(async () => {
    if (!agent) return
    const res = await fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish: !agent.published }),
    })
    if (res.ok) void load()
  }, [workspaceId, agentId, agent, load])

  const deleteRecording = useCallback(
    async (id: string) => {
      await fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}/recordings?id=${id}`, { method: 'DELETE' })
      void load()
    },
    [workspaceId, agentId, load],
  )

  if (!agent) return null

  const recStatus = (r: Recording) => {
    if (r.status === 'queued') return { label: 'Starting…', color: 'var(--accent-amber)' }
    if (r.status === 'processing') return { label: 'Reading & learning (this can take a minute or two)…', color: 'var(--accent-amber)' }
    if (r.status === 'failed') return { label: r.error || 'Failed', color: 'var(--accent-red)' }
    return { label: r.hasWalkthrough ? 'Learned — incl. screen navigation' : 'Learned', color: 'var(--accent-emerald)' }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 w-full">
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <Link href={`/dashboard/${workspaceId}/copilot`} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Co-Pilot agents
        </Link>
        <Link
          href={`/dashboard/${workspaceId}/copilot/run?agent=${agentId}`}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ background: 'var(--accent-primary)' }}
        >
          Start session
        </Link>
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Persona / tone</label>
          <textarea
            value={persona}
            onChange={e => setPersona(e.target.value)}
            rows={3}
            placeholder="e.g. Warm and patient. Explains the why, not just the click. Never rushes the user."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">How to start the call</label>
          <textarea
            value={openingLine}
            onChange={e => setOpeningLine(e.target.value)}
            rows={2}
            placeholder="e.g. Welcome them, introduce yourself by name, set expectations, then begin."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Information to ask the user for</label>
          <textarea
            value={collectInfo}
            onChange={e => setCollectInfo(e.target.value)}
            rows={2}
            placeholder="e.g. Their name and role; the business name; their main goal."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Procedure steps <span className="text-zinc-600">(one per line — the exact checklist the agent walks, in order)</span>
            </label>
            <textarea
              value={stepsText}
              onChange={e => setStepsText(e.target.value)}
              rows={6}
              placeholder={'Connect the CRM location\nImport the contact list\nDeploy the first channel\nSend a test message'}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              This is the agent&rsquo;s authoritative checklist — it walks these in order and won&rsquo;t skip them.
              Leave blank and it&rsquo;s auto-filled from your uploaded SOP/recordings; edit any time. Blank with no
              uploads = open-ended support.
            </p>
          </div>
          <div className="w-32">
            <label className="block text-xs font-medium text-zinc-400 mb-1">Timebox (min)</label>
            <input
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
            />
          </div>
        </div>

        {/* ── Learn from recordings ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-sm font-semibold text-zinc-100 mb-1">Teach it from real material</h3>
          <p className="text-xs text-zinc-400 mb-3">
            Upload a <strong>recording</strong> of a human running this procedure (a screen recording is ideal), or a{' '}
            <strong>document</strong> — an SOP as a PDF with screenshots, or a Markdown/text guide. The agent reads the
            screens and the steps, <strong>extracts the step-by-step checklist above</strong> (when it&rsquo;s blank),
            and writes a per-step playbook of exactly what to tell the user and where things are on screen. Add a few;
            it sharpens with each.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="px-3.5 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              {uploading
                ? uploadPct !== null && uploadPct < 100
                  ? `Uploading… ${uploadPct}%`
                  : 'Finishing upload…'
                : 'Upload recording or document'}
            </button>
            {agent.recordings.some(r => r.status === 'done') && (
              <button
                type="button"
                onClick={() => void relearn()}
                disabled={relearning}
                className="px-3.5 py-2 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                title="Re-extract steps + playbook from your existing sources"
              >
                {relearning ? 'Rebuilding…' : 'Rebuild steps & playbook'}
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".mp4,.mov,.webm,.mkv,.mp3,.m4a,.wav,.ogg,.aac,.pdf,.md,.markdown,.txt"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void upload(f)
              e.target.value = ''
            }}
          />

          {uploadPct !== null && uploadPct < 100 && (
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${uploadPct}%`, background: 'var(--accent-primary)' }} />
            </div>
          )}
          {uploadError && (
            <p className="mt-2 text-xs" style={{ color: 'var(--accent-red)' }}>{uploadError}</p>
          )}

          {agent.recordings.length > 0 && (
            <div className="mt-3 divide-y divide-zinc-800 border-t border-zinc-800">
              {agent.recordings.map(r => {
                const st = recStatus(r)
                return (
                  <div key={r.id} className="py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{r.originalFilename}</p>
                      <p className="text-xs flex items-center gap-1.5" style={{ color: st.color }}>
                        {(r.status === 'queued' || r.status === 'processing') && (
                          <span className="inline-block w-3 h-3 border-[1.5px] border-zinc-500 border-t-transparent rounded-full animate-spin" />
                        )}
                        {st.label}
                      </p>
                    </div>
                    <button onClick={() => void deleteRecording(r.id)} className="text-xs text-zinc-500 hover:text-zinc-300">
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Playbook ── */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">
            Playbook <span className="text-zinc-600">(distilled from recordings — edit freely)</span>
          </label>
          <textarea
            value={playbook}
            onChange={e => setPlaybook(e.target.value)}
            rows={8}
            placeholder="Upload recordings and this fills itself in — the learned step order, phrasings, objection handling, and where things live on screen. You can also write it by hand."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none font-mono leading-relaxed"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent-primary)' }}
          >
            {saving ? 'Saving…' : 'Save agent'}
          </button>
          {saved && <span className="text-sm" style={{ color: 'var(--accent-emerald)' }}>✓ Saved</span>}
        </div>

        {/* ── Deploy ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <h3 className="text-sm font-semibold text-zinc-100">Deploy</h3>
            <button
              type="button"
              onClick={() => void togglePublish()}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{ background: agent.published ? 'var(--accent-red)' : 'var(--accent-emerald)' }}
            >
              {agent.published ? 'Unpublish' : 'Publish'}
            </button>
          </div>
          <p className="text-xs text-zinc-400 mb-3">
            Publish to launch this agent from a shareable link, a button on any site, or a JavaScript snippet inside
            your app. Unpublishing disables all of them instantly (the key is kept, so re-publishing restores them).
          </p>
          {agent.published && agent.publicKey && (
            <div className="space-y-3">
              <DeployField label="Shareable link" value={`${window.location.origin}/copilot/live/${agent.publicKey}`} />
              <DeployField
                label="Button (HTML)"
                value={`<a href="${window.location.origin}/copilot/live/${agent.publicKey}" target="_blank" rel="noopener">Get live help</a>`}
              />
              <DeployField
                label="JavaScript snippet (floating button + window.VoxilityCopilot.launch())"
                value={`<script src="${window.location.origin}/copilot.js" data-copilot-key="${agent.publicKey}" async></script>`}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeployField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <p className="text-[11px] font-medium text-zinc-500 mb-1">{label}</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={value}
          onFocus={e => e.target.select()}
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-300 font-mono focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
