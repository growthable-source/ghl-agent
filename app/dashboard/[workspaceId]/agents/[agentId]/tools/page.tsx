'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ALL_TOOLS } from '@/lib/tools'

type WorkflowPick = { id: string; name: string }

export default function ToolsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [enabledTools, setEnabledTools] = useState<string[]>([])
  const [calendarId, setCalendarId] = useState('')
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)

  // Workflow picker state. The user picks one or more published workflows
  // per tool — the agent's tool schema is then constrained to those IDs so
  // it can't enroll a contact in a hallucinated workflow.
  const [addToWorkflowsPick, setAddToWorkflowsPick] = useState<WorkflowPick[]>([])
  const [removeFromWorkflowsPick, setRemoveFromWorkflowsPick] = useState<WorkflowPick[]>([])
  const [workflows, setWorkflows] = useState<WorkflowPick[]>([])
  const [loadingWorkflows, setLoadingWorkflows] = useState(false)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setEnabledTools(agent.enabledTools ?? [])
        setCalendarId(agent.calendarId ?? '')
        setAddToWorkflowsPick(Array.isArray(agent.addToWorkflowsPick) ? agent.addToWorkflowsPick : [])
        setRemoveFromWorkflowsPick(Array.isArray(agent.removeFromWorkflowsPick) ? agent.removeFromWorkflowsPick : [])
      })
      .finally(() => setLoading(false))

    // Preload calendars
    setLoadingCalendars(true)
    fetch(`/api/workspaces/${workspaceId}/calendars`)
      .then(r => r.json())
      .then(({ calendars }) => setCalendars(calendars ?? []))
      .catch(() => {})
      .finally(() => setLoadingCalendars(false))

    // Preload published workflows. 401 usually means the OAuth scope
    // `workflows.readonly` is missing — the endpoint surfaces a friendly
    // hint in that case.
    setLoadingWorkflows(true)
    fetch(`/api/workspaces/${workspaceId}/workflows`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          setWorkflowsError(body.error || `Failed to load workflows (${r.status})`)
          return { workflows: [] }
        }
        return r.json()
      })
      .then(({ workflows }) => setWorkflows(workflows ?? []))
      .catch(err => setWorkflowsError(err?.message ?? 'Failed to load workflows'))
      .finally(() => setLoadingWorkflows(false))
  }, [workspaceId, agentId])

  async function toggleTool(toolName: string) {
    const updated = enabledTools.includes(toolName)
      ? enabledTools.filter(t => t !== toolName)
      : [...enabledTools, toolName]
    setEnabledTools(updated)
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledTools: updated }),
    })
  }

  async function updateWorkflowPick(
    which: 'addTo' | 'removeFrom',
    next: WorkflowPick[],
  ) {
    if (which === 'addTo') setAddToWorkflowsPick(next)
    else setRemoveFromWorkflowsPick(next)
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        which === 'addTo'
          ? { addToWorkflowsPick: next }
          : { removeFromWorkflowsPick: next },
      ),
    })
  }

  async function saveCalendarId(id: string) {
    setCalendarId(id)

    // Auto-enable booking tools when a calendar is selected. Without these
    // tools, setting a calendar ID is a no-op — the agent has no way to use it.
    const autoEnable = ['get_available_slots', 'book_appointment', 'create_appointment_note']
    const missing = autoEnable.filter(t => !enabledTools.includes(t))
    const updatedTools = missing.length > 0 ? [...enabledTools, ...missing] : enabledTools
    if (missing.length > 0) setEnabledTools(updatedTools)

    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: id,
        ...(missing.length > 0 ? { enabledTools: updatedTools } : {}),
      }),
    })
  }

  const [diag, setDiag] = useState<{ ok: boolean; results: Array<{ step: string; status: string; detail: string; fix?: string }> } | null>(null)
  const [runningDiag, setRunningDiag] = useState(false)

  async function runDiagnostic() {
    setRunningDiag(true)
    setDiag(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/calendar-diagnostic`)
      const data = await res.json()
      setDiag(data)
    } finally { setRunningDiag(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  const calendarToolsEnabled = (['get_available_slots', 'book_appointment'] as const).some(t => enabledTools.includes(t))

  return (
    <div className="p-8 max-w-2xl space-y-8">
      {(['messaging', 'contacts', 'pipeline', 'calendar', 'intelligence', 'automation'] as const).map(category => {
        const categoryTools = ALL_TOOLS.filter(t => t.category === category)
        if (categoryTools.length === 0) return null
        return (
          <div key={category}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 capitalize">{category}</h3>
            <div className="space-y-2">
              {categoryTools.map(tool => {
                const isEnabled = enabledTools.includes(tool.name)
                const isWorkflowTool = tool.name === 'add_to_workflow' || tool.name === 'remove_from_workflow'
                const which: 'addTo' | 'removeFrom' | null =
                  tool.name === 'add_to_workflow' ? 'addTo' :
                  tool.name === 'remove_from_workflow' ? 'removeFrom' : null
                const pick = which === 'addTo' ? addToWorkflowsPick : which === 'removeFrom' ? removeFromWorkflowsPick : []
                return (
                  <div key={tool.name}>
                    <div
                      className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                        isEnabled ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-800'
                      } ${isWorkflowTool && isEnabled && pick.length === 0 ? 'rounded-b-none border-b-0' : ''}`}
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
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                          isEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>

                    {which && isEnabled && (
                      <WorkflowPicker
                        verb={which === 'addTo' ? 'enroll in' : 'remove from'}
                        pick={pick}
                        workflows={workflows}
                        loading={loadingWorkflows}
                        error={workflowsError}
                        onChange={next => updateWorkflowPick(which, next)}
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {category === 'calendar' && (
              <div className={`rounded-lg border px-4 py-4 mt-3 ${
                calendarId
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : calendarToolsEnabled
                  ? 'border-amber-500/40 bg-amber-500/5'
                  : 'border-zinc-700 bg-zinc-900/50'
              }`}>
                <div className="flex items-start gap-2 mb-1">
                  <label className="block text-sm font-medium text-zinc-300">Connected Calendar</label>
                  {calendarId && (
                    <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10">
                      ✓ Configured
                    </span>
                  )}
                  {!calendarId && calendarToolsEnabled && (
                    <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10">
                      ⚠ Required
                    </span>
                  )}
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  {calendarId
                    ? 'The agent will use this calendar to check availability and book appointments.'
                    : calendarToolsEnabled
                    ? 'Your agent has booking tools enabled but no calendar to use. Pick one below — booking will not work without it.'
                    : 'Select a calendar to enable booking. The booking tools will be enabled automatically when you pick one.'}
                </p>
                {loadingCalendars ? (
                  <p className="text-sm text-zinc-500">Loading…</p>
                ) : calendars.length === 0 ? (
                  <p className="text-sm text-red-400">No calendars found in this GHL location. Create one in GoHighLevel first, then come back here.</p>
                ) : (
                  <select
                    value={calendarId}
                    onChange={e => saveCalendarId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select a calendar…</option>
                    {calendars.map(cal => (
                      <option key={cal.id} value={cal.id}>{cal.name}</option>
                    ))}
                  </select>
                )}
                {calendarId && <p className="text-xs text-zinc-600 mt-2 font-mono">{calendarId}</p>}

                {/* Diagnostic */}
                <div className="mt-4 pt-3 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-400">
                      Booking not working? Run a full connection test.
                    </p>
                    <button
                      onClick={runDiagnostic}
                      disabled={runningDiag}
                      className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors disabled:opacity-50"
                    >
                      {runningDiag ? 'Testing…' : 'Test calendar connection'}
                    </button>
                  </div>

                  {diag && (
                    <div className={`mt-3 p-3 rounded-lg border ${
                      diag.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'
                    }`}>
                      <p className={`text-xs font-semibold mb-2 ${diag.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {diag.ok ? '✓ Calendar integration is working' : '✗ Something is blocking booking'}
                      </p>
                      <div className="space-y-1.5">
                        {diag.results.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-[11px]">
                            <span className={`mt-0.5 shrink-0 ${
                              r.status === 'ok' ? 'text-emerald-400'
                              : r.status === 'warn' ? 'text-amber-400'
                              : 'text-red-400'
                            }`}>
                              {r.status === 'ok' ? '✓' : r.status === 'warn' ? '⚠' : '✗'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-zinc-200 font-medium">{r.step}</p>
                              <p className="text-zinc-500 break-words">{r.detail}</p>
                              {r.fix && (
                                <p className="text-amber-300 mt-0.5">→ {r.fix}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Workflow picker panel ───────────────────────────────────────────────
// Renders below an enabled add_to_workflow / remove_from_workflow toggle.
// Warns when no selection is made — the tool is effectively disabled in
// that case (ai-agent.ts drops the tool from the published set entirely
// when the pick array is empty).
function WorkflowPicker({
  verb,
  pick,
  workflows,
  loading,
  error,
  onChange,
}: {
  verb: string
  pick: WorkflowPick[]
  workflows: WorkflowPick[]
  loading: boolean
  error: string | null
  onChange: (next: WorkflowPick[]) => void
}) {
  const pickedIds = new Set(pick.map(p => p.id))
  const available = workflows.filter(w => !pickedIds.has(w.id))
  const noSelection = pick.length === 0

  return (
    <div className={`rounded-b-lg border border-t-0 px-4 py-3 space-y-3 ${
      noSelection ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-700 bg-zinc-950/50'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-zinc-300">
            Workflows the agent can {verb}
          </p>
          <p className="text-xs text-zinc-600 mt-0.5">
            {noSelection
              ? `Pick at least one workflow — the agent can't ${verb} any contacts until you do.`
              : `The agent can only ${verb} these workflows. Nothing else is reachable.`}
          </p>
        </div>
        {noSelection && (
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 whitespace-nowrap">
            ⚠ Required
          </span>
        )}
      </div>

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-xs text-zinc-500">Loading workflows…</p>
      ) : workflows.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No published workflows in this location. Publish one in GoHighLevel, then refresh.
        </p>
      ) : (
        <>
          {pick.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pick.map(w => (
                <span
                  key={w.id}
                  className="inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-200 text-xs rounded-full pl-3 pr-1.5 py-1"
                >
                  {w.name}
                  <button
                    type="button"
                    onClick={() => onChange(pick.filter(p => p.id !== w.id))}
                    className="w-4 h-4 flex items-center justify-center rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
                    aria-label={`Remove ${w.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {available.length > 0 && (
            <select
              value=""
              onChange={e => {
                const wf = workflows.find(w => w.id === e.target.value)
                if (wf) onChange([...pick, wf])
              }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="">{pick.length === 0 ? 'Select a workflow…' : 'Add another workflow…'}</option>
              {available.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  )
}
