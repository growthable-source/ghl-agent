'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type RuleType = 'ALL' | 'TAG' | 'PIPELINE_STAGE' | 'KEYWORD'

interface Agent {
  id: string
  name: string
  systemPrompt: string
  instructions: string | null
  isActive: boolean
  routingRules: Array<{ id: string; ruleType: RuleType; value: string | null; priority: number }>
  knowledgeEntries: Array<{ id: string; title: string; content: string }>
}

export default function AgentPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [agent, setAgent] = useState<Agent | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'settings' | 'knowledge' | 'rules'>('settings')

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

  // Rules state
  const [ruleType, setRuleType] = useState<RuleType>('ALL')
  const [ruleValue, setRuleValue] = useState('')
  const [addingRule, setAddingRule] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then((r) => r.json())
      .then(({ agent }) => {
        setAgent(agent)
        setName(agent.name)
        setSystemPrompt(agent.systemPrompt)
        setInstructions(agent.instructions ?? '')
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

  if (loading) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  if (!agent) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <p className="text-zinc-500 text-sm">Agent not found.</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-zinc-500 mb-8">
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <span>/</span>
          <Link href={`/dashboard/${locationId}`} className="hover:text-white transition-colors font-mono">{locationId}</Link>
          <span>/</span>
          <span className="text-zinc-300">{agent.name}</span>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <span className={`w-2.5 h-2.5 rounded-full ${agent.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <h1 className="text-2xl font-semibold">{agent.name}</h1>
          </div>
          <button
            onClick={toggleActive}
            className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
          >
            {agent.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 border-b border-zinc-800">
          {(['settings', 'knowledge', 'rules'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-white text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab}
              {tab === 'knowledge' && ` (${agent.knowledgeEntries.length})`}
              {tab === 'rules' && ` (${agent.routingRules.length})`}
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
            {agent.knowledgeEntries.length > 0 && (
              <div className="space-y-3">
                {agent.knowledgeEntries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-zinc-800 px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-200">{entry.title}</p>
                        <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{entry.content}</p>
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

            <div className="rounded-lg border border-zinc-800 p-4">
              <p className="text-sm font-medium text-zinc-300 mb-4">Add Knowledge Entry</p>
              <form onSubmit={addKnowledge} className="space-y-3">
                <input
                  type="text"
                  value={kTitle}
                  onChange={(e) => setKTitle(e.target.value)}
                  placeholder="Title (e.g. Pricing, FAQ, About Us)"
                  required
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <textarea
                  value={kContent}
                  onChange={(e) => setKContent(e.target.value)}
                  placeholder="Paste the content the agent should know about…"
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
            </div>
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
      </div>
    </div>
  )
}
