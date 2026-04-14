'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const TEMPLATES = [
  {
    name: 'Sales Assistant',
    prompt: 'You are a friendly and professional sales assistant. Your goal is to qualify leads, answer questions about our products and services, and guide interested prospects toward booking a call or making a purchase. Keep responses concise and conversational.',
  },
  {
    name: 'Customer Support',
    prompt: 'You are a helpful customer support agent. You assist customers with questions, troubleshooting, and account issues. Be empathetic, clear, and solution-focused. Escalate complex issues by tagging the contact.',
  },
  {
    name: 'Appointment Setter',
    prompt: 'You are an appointment scheduling assistant. Your goal is to qualify the lead and book them into a consultation call. Ask qualifying questions, handle objections, and guide them to pick a time that works.',
  },
]

export default function OnboardingWizard({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [agentName, setAgentName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [agentId, setAgentId] = useState<string | null>(null)

  async function createAgent() {
    setSaving(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentName,
        systemPrompt,
        enabledTools: ['get_contact_details', 'send_sms', 'update_contact_tags'],
      }),
    })
    const { agent } = await res.json()

    // Add ALL routing rule
    await fetch(`/api/workspaces/${workspaceId}/agents/${agent.id}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleType: 'ALL', priority: 999 }),
    })

    setAgentId(agent.id)
    setSaving(false)
    setStep(2)
  }

  async function complete() {
    await fetch(`/api/workspaces/${workspaceId}/onboarding-complete`, { method: 'PATCH' })
    router.push(`/dashboard/${workspaceId}`)
  }

  const steps = [
    { label: 'Welcome' },
    { label: 'Create Agent' },
    { label: "You're Live" },
  ]

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-8">
      <div className="max-w-lg w-full">
        {/* Progress */}
        <div className="flex items-center gap-2 mb-10">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                i < step ? 'bg-emerald-500 text-black' :
                i === step ? 'bg-white text-black' :
                'bg-zinc-800 text-zinc-500'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className={`h-px w-8 ${i < step ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
              )}
            </div>
          ))}
          <span className="ml-2 text-sm text-zinc-400">{steps[step].label}</span>
        </div>

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-sm text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              Connected
            </div>
            <h1 className="text-3xl font-semibold mb-3">Welcome to GHL Agent</h1>
            <p className="text-zinc-400 mb-8">
              Let&apos;s get your AI SMS agent set up in 2 minutes. We&apos;ll create your first agent and it&apos;ll be live immediately.
            </p>
            <div className="rounded-lg border border-zinc-800 px-4 py-3 mb-8">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Workspace ID</span>
                <span className="font-mono text-zinc-300">{workspaceId.slice(0, 16)}…</span>
              </div>
            </div>
            <button
              onClick={() => setStep(1)}
              className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-11 px-6 hover:bg-zinc-200 transition-colors"
            >
              Get Started →
            </button>
          </div>
        )}

        {/* Step 1 — Create Agent */}
        {step === 1 && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Create your first agent</h1>
            <p className="text-zinc-400 text-sm mb-6">Pick a template or write your own system prompt.</p>

            <div className="space-y-2 mb-6">
              {TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelectedTemplate(i)
                    setAgentName(t.name)
                    setSystemPrompt(t.prompt)
                  }}
                  className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                    selectedTemplate === i
                      ? 'border-white bg-zinc-900'
                      : 'border-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{t.prompt.slice(0, 80)}…</p>
                </button>
              ))}
            </div>

            <div className="space-y-3 mb-6">
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Agent name"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Or write a custom system prompt…"
                rows={4}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={createAgent}
                disabled={saving || !agentName.trim() || !systemPrompt.trim()}
                className="flex-1 inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-5 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Agent'}
              </button>
              <button onClick={() => setStep(0)} className="text-sm text-zinc-500 hover:text-white transition-colors">
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Done */}
        {step === 2 && (
          <div>
            <div className="mb-4 text-4xl">🎉</div>
            <h1 className="text-2xl font-semibold mb-2">Your agent is live</h1>
            <p className="text-zinc-400 text-sm mb-8">
              Any inbound SMS to your GHL number will now be handled automatically. Test it from the Playground.
            </p>
            <div className="space-y-3">
              <button
                onClick={complete}
                className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-11 px-6 hover:bg-zinc-200 transition-colors"
              >
                Go to Dashboard
              </button>
              {agentId && (
                <a
                  href={`/dashboard/${workspaceId}/playground?agentId=${agentId}`}
                  className="w-full inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm h-11 px-6 hover:border-zinc-500 hover:text-white transition-colors"
                >
                  Test in Playground
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
