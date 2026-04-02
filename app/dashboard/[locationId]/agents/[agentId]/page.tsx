'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ALL_TOOLS } from '@/lib/tools'

type RuleType = 'ALL' | 'TAG' | 'PIPELINE_STAGE' | 'KEYWORD'

interface Agent {
  id: string
  name: string
  systemPrompt: string
  instructions: string | null
  isActive: boolean
  enabledTools: string[]
  calendarId: string | null
  routingRules: Array<{ id: string; ruleType: RuleType; value: string | null; priority: number }>
  knowledgeEntries: Array<{
    id: string
    title: string
    content: string
    source: string
    sourceUrl: string | null
    tokenEstimate: number
  }>
}

export default function AgentPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'settings' | 'knowledge' | 'rules' | 'tools'>('settings')

  // Settings state
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // Knowledge state
  const [kTitle, setKTitle] = useState('')
  const [kContent, setKContent] = useState('')
  const [addingK, setAddingK] = useState(false)
  const [knowledgeTab, setKnowledgeTab] = useState<'manual' | 'url' | 'file'>('manual')
  const [crawlUrl_, setCrawlUrl] = useState('')
  const [crawling, setCrawling] = useState(false)
  const [crawlResult, setCrawlResult] = useState('')
  const [uploadResult, setUploadResult] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Rules state
  const [ruleType, setRuleType] = useState<RuleType>('ALL')
  const [ruleValue, setRuleValue] = useState('')
  const [addingRule, setAddingRule] = useState(false)

  // Tools state
  const [enabledTools, setEnabledTools] = useState<string[]>([])
  const [calendarId, setCalendarId] = useState<string>('')
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then((r) => r.json())
      .then(({ agent }) => {
        setAgent(agent)
        setName(agent.name)
        setSystemPrompt(agent.systemPrompt)
        setInstructions(agent.instructions ?? '')
        setEnabledTools(agent.enabledTools ?? [])
        setCalendarId(agent.calendarId ?? '')
      })
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg('')
    await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, systemPrompt, instructions }),
    })
    setSaving(false)
    setSaveMsg('Saved')
    setTimeout(() => setSaveMsg(''), 2000)
  }

  async function toggleActive() {
    if (!agent) return
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !agent.isActive }),
    })
    const { agent: updated } = await res.json()
    setAgent({ ...agent, isActive: updated.isActive })
  }

  async function addKnowledge(e: React.FormEvent) {
    e.preventDefault()
    if (!kTitle.trim() || !kContent.trim()) return
    setAddingK(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: kTitle, content: kContent }),
    })
    const { entry } = await res.json()
    setAgent((a) => a ? { ...a, knowledgeEntries: [...a.knowledgeEntries, entry] } : a)
    setKTitle('')
    setKContent('')
    setAddingK(false)
  }

  async function deleteKnowledge(entryId: string) {
    await fetch(`/api/locations/${locationId}/agents/${agentId}/knowledge/${entryId}`, { method: 'DELETE' })
    setAgent((a) => a ? { ...a, knowledgeEntries: a.knowledgeEntries.filter((e) => e.id !== entryId) } : a)
  }

  async function crawlUrl(e: React.FormEvent) {
    e.preventDefault()
    setCrawling(true)
    setCrawlResult('')
    try {
      const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/knowledge/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: crawlUrl_ }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCrawlResult(`✓ Added ${data.chunks} chunk${data.chunks !== 1 ? 's' : ''} from "${data.title}" (~${data.totalTokens} tokens)`)
      setCrawlUrl('')
      // Refresh entries
      const r2 = await fetch(`/api/locations/${locationId}/agents/${agentId}`)
      const { agent: updated } = await r2.json()
      setAgent(updated)
    } catch (err: any) {
      setCrawlResult(`Error: ${err.message}`)
    }
    setCrawling(false)
  }

  async function uploadFile(file: File) {
    setUploading(true)
    setUploadResult('')
    setDragOver(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/knowledge/upload`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setUploadResult(`✓ Added ${data.chunks} chunk${data.chunks !== 1 ? 's' : ''} from "${data.fileName}" (~${data.totalTokens} tokens)`)
      // Refresh entries
      const r2 = await fetch(`/api/locations/${locationId}/agents/${agentId}`)
      const { agent: updated } = await r2.json()
      setAgent(updated)
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`)
    }
    setUploading(false)
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) uploadFile(file)
  }

  async function addRule(e: React.FormEvent) {
    e.preventDefault()
    setAddingRule(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleType, value: ruleValue || null }),
    })
    const { rule } = await res.json()
    setAgent((a) => a ? { ...a, routingRules: [...a.routingRules, rule].sort((x, y) => x.priority - y.priority) } : a)
    setRuleType('ALL')
    setRuleValue('')
    setAddingRule(false)
  }

  async function deleteRule(ruleId: string) {
    await fetch(`/api/locations/${locationId}/agents/${agentId}/rules/${ruleId}`, { method: 'DELETE' })
    setAgent((a) => a ? { ...a, routingRules: a.routingRules.filter((r) => r.id !== ruleId) } : a)
  }

  async function loadCalendars() {
    if (calendars.length > 0) return
    setLoadingCalendars(true)
    try {
      const res = await fetch(`/api/locations/${locationId}/calendars`)
      const data = await res.json()
      setCalendars(data.calendars ?? [])
    } catch {}
    setLoadingCalendars(false)
  }

  async function saveCalendarId(id: string) {
    setCalendarId(id)
    await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: id }),
    })
  }

  async function toggleTool(toolName: string) {
    const updated = enabledTools.includes(toolName)
      ? enabledTools.filter(t => t !== toolName)
      : [...enabledTools, toolName]
    setEnabledTools(updated)
    await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledTools: updated }),
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  if (!agent) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Agent not found.</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${agent.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/dashboard/${locationId}/playground?agentId=${agentId}`}
              className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
            >
              Test in Playground
            </Link>
            <button
              onClick={toggleActive}
              className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
            >
              {agent.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>

        {/* Primary Tabs */}
        <div className="flex gap-0.5 mb-8 border-b border-zinc-800 overflow-x-auto">
          {(['settings', 'knowledge', 'rules', 'tools'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); if (tab === 'tools') loadCalendars() }}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px shrink-0 ${
                activeTab === tab
                  ? 'border-white text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
              {tab === 'knowledge' && ` (${agent.knowledgeEntries.length})`}
              {tab === 'rules' && ` (${agent.routingRules.length})`}
              {tab === 'tools' && ` (${enabledTools.length})`}
            </button>
          ))}
        </div>

        {/* Settings */}
        {activeTab === 'settings' && (
          <form onSubmit={saveSettings} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                required
                rows={8}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Additional Instructions <span className="text-zinc-600">(optional)</span>
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-5 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {saveMsg && <span className="text-emerald-400 text-sm">{saveMsg}</span>}
            </div>
          </form>
        )}

        {/* Knowledge Base */}
        {activeTab === 'knowledge' && (
          <div className="space-y-6">
            {/* Token budget indicator */}
            {agent.knowledgeEntries.length > 0 && (
              <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
                <span>{agent.knowledgeEntries.length} entries</span>
                <span>
                  ~{agent.knowledgeEntries.reduce((sum, e) => sum + (e.tokenEstimate || 0), 0).toLocaleString()} tokens
                  {agent.knowledgeEntries.length > 15 && (
                    <span className="ml-1 text-emerald-500">(smart retrieval active)</span>
                  )}
                </span>
              </div>
            )}

            {/* Existing entries */}
            {agent.knowledgeEntries.length > 0 && (
              <div className="space-y-2">
                {agent.knowledgeEntries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-zinc-800 px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-sm font-medium text-zinc-200">{entry.title}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            (entry.source || 'manual') === 'url' ? 'bg-blue-900/40 text-blue-400' :
                            (entry.source || 'manual') === 'file' ? 'bg-purple-900/40 text-purple-400' :
                            'bg-zinc-800 text-zinc-500'
                          }`}>
                            {(entry.source || 'manual') === 'url' ? '🔗 url' : (entry.source || 'manual') === 'file' ? '📄 file' : '✏️ manual'}
                          </span>
                          {(entry.tokenEstimate || 0) > 0 && (
                            <span className="text-xs text-zinc-600">~{entry.tokenEstimate} tokens</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-500 line-clamp-2">{entry.content}</p>
                        {entry.sourceUrl && (
                          <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-blue-500 hover:text-blue-400 truncate block mt-1">
                            {entry.sourceUrl}
                          </a>
                        )}
                      </div>
                      <button
                        onClick={() => deleteKnowledge(entry.id)}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add knowledge — tabbed */}
            <div className="rounded-lg border border-zinc-800 overflow-hidden">
              <div className="flex border-b border-zinc-800">
                {(['manual', 'url', 'file'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setKnowledgeTab(t)}
                    className={`flex-1 px-4 py-2.5 text-xs font-medium capitalize transition-colors ${
                      knowledgeTab === t
                        ? 'bg-zinc-800 text-white'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {t === 'manual' ? '✏️ Write' : t === 'url' ? '🔗 URL' : '📄 File'}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {/* Manual */}
                {knowledgeTab === 'manual' && (
                  <form onSubmit={addKnowledge} className="space-y-3">
                    <input
                      type="text"
                      value={kTitle}
                      onChange={(e) => setKTitle(e.target.value)}
                      placeholder="Title (e.g. Pricing, FAQ)"
                      required
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                    <textarea
                      value={kContent}
                      onChange={(e) => setKContent(e.target.value)}
                      placeholder="Paste content here…"
                      required
                      rows={4}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
                    />
                    <button
                      type="submit"
                      disabled={addingK}
                      className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                    >
                      {addingK ? 'Adding…' : 'Add Entry'}
                    </button>
                  </form>
                )}

                {/* URL */}
                {knowledgeTab === 'url' && (
                  <form onSubmit={crawlUrl} className="space-y-3">
                    <input
                      type="url"
                      value={crawlUrl_}
                      onChange={(e) => setCrawlUrl(e.target.value)}
                      placeholder="https://example.com/page"
                      required
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                    <p className="text-xs text-zinc-600">The page content will be fetched, cleaned, and split into chunks automatically.</p>
                    {crawlResult && (
                      <p className={`text-xs ${crawlResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                        {crawlResult}
                      </p>
                    )}
                    <button
                      type="submit"
                      disabled={crawling}
                      className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                    >
                      {crawling ? 'Fetching…' : 'Crawl Page'}
                    </button>
                  </form>
                )}

                {/* File */}
                {knowledgeTab === 'file' && (
                  <div className="space-y-3">
                    <div
                      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                        dragOver ? 'border-zinc-500 bg-zinc-800/50' : 'border-zinc-700'
                      }`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={handleFileDrop}
                    >
                      <p className="text-sm text-zinc-400 mb-2">Drop a file here or</p>
                      <label className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors cursor-pointer">
                        Browse
                        <input
                          type="file"
                          accept=".pdf,.txt,.md"
                          className="hidden"
                          onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
                        />
                      </label>
                      <p className="text-xs text-zinc-600 mt-2">PDF, TXT, MD — max 5MB</p>
                    </div>
                    {uploadResult && (
                      <p className={`text-xs ${uploadResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
                        {uploadResult}
                      </p>
                    )}
                    {uploading && <p className="text-xs text-zinc-500">Uploading and processing…</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tools */}
        {activeTab === 'tools' && (
          <div className="space-y-8">
            <p className="text-sm text-zinc-400">
              Enable or disable tools available to this agent. Calendar tools require a calendar ID to be configured in your system prompt.
            </p>
            {(['messaging', 'contacts', 'pipeline', 'calendar'] as const).map((category) => {
              const categoryTools = ALL_TOOLS.filter(t => t.category === category)
              return (
                <div key={category}>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
                    {category}
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    {categoryTools.map((tool) => {
                      const isEnabled = enabledTools.includes(tool.name)
                      return (
                        <div
                          key={tool.name}
                          className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                            isEnabled ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-800 bg-transparent'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isEnabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
                              {tool.label}
                            </p>
                            <p className="text-xs text-zinc-600 mt-0.5">{tool.description}</p>
                          </div>
                          <button
                            onClick={() => toggleTool(tool.name)}
                            className={`ml-4 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                              isEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                            }`}
                            role="switch"
                            aria-checked={isEnabled}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                                isEnabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {/* Calendar picker — show when any calendar tool is enabled */}
                  {category === 'calendar' && (['get_available_slots', 'book_appointment'] as const).some(t => enabledTools.includes(t)) && (
                    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-4 mt-2">
                      <label className="block text-sm font-medium text-zinc-300 mb-1">
                        Connected Calendar
                      </label>
                      <p className="text-xs text-zinc-500 mb-3">
                        The agent will use this calendar to check availability and book appointments.
                      </p>
                      {loadingCalendars ? (
                        <p className="text-sm text-zinc-500">Loading calendars…</p>
                      ) : calendars.length === 0 ? (
                        <p className="text-sm text-red-400">No calendars found for this location.</p>
                      ) : (
                        <select
                          value={calendarId}
                          onChange={(e) => saveCalendarId(e.target.value)}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                        >
                          <option value="">Select a calendar…</option>
                          {calendars.map((cal) => (
                            <option key={cal.id} value={cal.id}>{cal.name}</option>
                          ))}
                        </select>
                      )}
                      {calendarId && (
                        <p className="text-xs text-zinc-600 mt-2 font-mono">{calendarId}</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Routing Rules */}
        {activeTab === 'rules' && (
          <div className="space-y-6">
            <p className="text-sm text-zinc-400">
              Rules are evaluated in priority order. The first matching rule activates this agent. Lower priority number = evaluated first.
            </p>

            {agent.routingRules.length > 0 && (
              <div className="space-y-2">
                {agent.routingRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-zinc-600 w-4">{rule.priority}</span>
                      <div>
                        <span className="text-xs font-medium text-zinc-300 bg-zinc-800 rounded px-2 py-0.5">
                          {rule.ruleType}
                        </span>
                        {rule.value && (
                          <span className="ml-2 text-sm text-zinc-400">{rule.value}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg border border-zinc-800 p-4">
              <p className="text-sm font-medium text-zinc-300 mb-4">Add Routing Rule</p>
              <form onSubmit={addRule} className="space-y-3">
                <select
                  value={ruleType}
                  onChange={(e) => { setRuleType(e.target.value as RuleType); setRuleValue('') }}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                >
                  <option value="ALL">All inbound messages</option>
                  <option value="TAG">Contact has tag</option>
                  <option value="PIPELINE_STAGE">Contact in pipeline stage</option>
                  <option value="KEYWORD">Message contains keyword(s)</option>
                </select>

                {ruleType !== 'ALL' && (
                  <input
                    type="text"
                    value={ruleValue}
                    onChange={(e) => setRuleValue(e.target.value)}
                    placeholder={
                      ruleType === 'TAG' ? 'e.g. hot-lead' :
                      ruleType === 'PIPELINE_STAGE' ? 'Pipeline stage ID' :
                      'e.g. price, cost, how much (comma separated)'
                    }
                    required
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                )}

                <button
                  type="submit"
                  disabled={addingRule}
                  className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {addingRule ? 'Adding…' : 'Add Rule'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Advanced */}
        <div className="mt-10 pt-6 border-t border-zinc-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">Advanced</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              {
                href: `/dashboard/${locationId}/agents/${agentId}/persona`,
                icon: '🎭',
                label: 'Persona & Tone',
                desc: 'Voice, formality, typos, typing delays',
              },
              {
                href: `/dashboard/${locationId}/agents/${agentId}/goals`,
                icon: '🎯',
                label: 'Goals & Stop Conditions',
                desc: 'When to pause or hand off to a human',
              },
              {
                href: `/dashboard/${locationId}/agents/${agentId}/follow-ups`,
                icon: '📬',
                label: 'Follow-up Sequences',
                desc: 'Auto-messages for non-responsive contacts',
              },
              {
                href: `/dashboard/${locationId}/agents/${agentId}/qualifying`,
                icon: '✅',
                label: 'Qualifying Questions',
                desc: 'Ask questions with conditional actions',
              },
            ].map(item => (
              <a
                key={item.href}
                href={item.href}
                className="block rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-950 p-4 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-base">{item.icon}</span>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">{item.label}</p>
                </div>
                <p className="text-xs text-zinc-500">{item.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
