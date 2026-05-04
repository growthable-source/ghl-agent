'use client'

/**
 * Funnel creation wizard — 5 steps:
 *   1. Intake     — name + 6-question intake (drives the AI generator)
 *   2. Generate   — AI builds the page spec; user previews + can regenerate
 *   3. Agents     — pick triggered + conversational from existing agents
 *   4. Tracking   — Meta pixel + Google conversion ids (optional)
 *   5. Publish    — show URL + ad-handoff CTA
 *
 * State lives in this single component. Each step is gated by validation
 * of the previous one. After the wizard ends, the user lands on the
 * funnel's detail page (Phase 5b) or just the funnels list.
 */

import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Intake {
  business_name: string
  offer: string
  dream_outcome: string
  false_belief: string
  mechanism: string
  proof: string
  price?: string
  audience?: string
  industry?: string
  brand_voice?: 'friendly' | 'authoritative' | 'playful' | 'luxury'
}

interface AgentRow {
  id: string
  name: string
}

interface GeneratedPage {
  title: string
  meta_description: string
  spec: { version: 1; style: { primary_color?: string }; sections: { type: string; headline?: string; body?: string }[] }
}

const GOALS = [
  { value: 'lead_gen', label: 'Lead generation' },
  { value: 'book_call', label: 'Book a call' },
  { value: 'webinar_signup', label: 'Webinar signup' },
  { value: 'sale', label: 'Direct sale' },
  { value: 'application', label: 'Application' },
  { value: 'waitlist', label: 'Waitlist' },
] as const

type Goal = (typeof GOALS)[number]['value']

type Step = 1 | 2 | 3 | 4 | 5

export default function NewFunnelWizard() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const workspaceId = params.workspaceId

  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Step 1
  const [name, setName] = useState('')
  const [goal, setGoal] = useState<Goal>('lead_gen')
  const [intake, setIntake] = useState<Intake>({
    business_name: '',
    offer: '',
    dream_outcome: '',
    false_belief: '',
    mechanism: '',
    proof: '',
    price: '',
    audience: '',
    industry: '',
    brand_voice: 'friendly',
  })
  const [primaryColor, setPrimaryColor] = useState('#0A84FF')

  // Persisted server state
  const [campaignId, setCampaignId] = useState<string | null>(null)

  // Step 2
  const [generated, setGenerated] = useState<GeneratedPage | null>(null)

  // Step 3
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [triggeredAgentId, setTriggeredAgentId] = useState<string>('')
  const [conversationalAgentId, setConversationalAgentId] = useState<string>('')

  // Step 4
  const [metaPixelId, setMetaPixelId] = useState('')
  const [googleConversionId, setGoogleConversionId] = useState('')
  const [googleConversionLabel, setGoogleConversionLabel] = useState('')

  // Step 5
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)

  // Load agents once we hit step 3
  useEffect(() => {
    if (step !== 3 || agents.length > 0) return
    fetch(`/api/workspaces/${workspaceId}/agents`)
      .then((r) => r.json() as Promise<{ agents?: { id: string; name: string }[] }>)
      .then((d) => setAgents((d.agents ?? []).map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => {/* non-fatal — user can skip */})
  }, [step, workspaceId, agents.length])

  // Warn before unload if we have unsaved progress.
  useEffect(() => {
    const hasProgress = name || intake.business_name || campaignId
    if (!hasProgress || step === 5) return
    function onUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [name, intake.business_name, campaignId, step])

  // Step 1 → 2: create campaign + kick off generation
  async function submitStep1(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !intake.business_name.trim() || !intake.offer.trim() || !intake.dream_outcome.trim()) {
      setError('Name, business, offer, and dream outcome are required.')
      return
    }
    setBusy(true)
    try {
      // Create the campaign
      const created = await fetch(`/api/workspaces/${workspaceId}/funnels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          goal,
          offer_summary: intake.offer,
          intake,
          brand_voice: intake.brand_voice,
          primary_color: primaryColor,
        }),
      })
      if (!created.ok) throw new Error((await created.json()).error ?? 'Create failed')
      const { campaign } = (await created.json()) as { campaign: { id: string } }
      setCampaignId(campaign.id)
      setStep(2)
      void generatePage(campaign.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function generatePage(_campaignId: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/generate-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intake, primary_color: primaryColor }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Generation failed')
      const data = (await r.json()) as GeneratedPage
      setGenerated(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }

  // Step 3 → 4: persist agent picks
  async function submitStep3() {
    if (!campaignId) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          triggered_agent_id: triggeredAgentId || null,
          conversational_agent_id: conversationalAgentId || null,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Save failed')
      setStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  // Step 4 → 5: create + publish landing page
  async function submitStep4() {
    if (!campaignId || !generated) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}/landing-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: generated.title,
          meta_description: generated.meta_description,
          spec: generated.spec,
          template: 'vsl',
          meta_pixel_id: metaPixelId.trim() || null,
          google_conversion_id: googleConversionId.trim() || null,
          google_conversion_label: googleConversionLabel.trim() || null,
          publish: true,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Publish failed')
      const data = (await r.json()) as { landing_page: { url: string } }
      setPublishedUrl(`${window.location.origin}${data.landing_page.url}`)
      // Flip campaign status to live
      await fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'live' }),
      })
      setStep(5)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Stepper step={step} />

      {error && (
        <div className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {step === 1 && (
        <form onSubmit={submitStep1} className="mt-6 space-y-6">
          <Card title="Tell us about the campaign" subtitle="This drives the AI page generator. Be specific — vague inputs make vague pages.">
            <Field label="Campaign name" hint="Internal — not shown to leads.">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Brisbane chiro — Q3" />
            </Field>
            <Field label="Goal">
              <div className="grid gap-2 md:grid-cols-3">
                {GOALS.map((g) => (
                  <button
                    type="button"
                    key={g.value}
                    onClick={() => setGoal(g.value)}
                    className={`rounded-md border p-3 text-left text-sm ${goal === g.value ? 'border-blue-600 bg-blue-50' : 'border-neutral-200 hover:bg-neutral-50'}`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </Field>
          </Card>

          <Card title="The 6-question intake">
            <Field label="Business name">
              <input value={intake.business_name} onChange={(e) => setIntake({ ...intake, business_name: e.target.value })} className={inputCls} placeholder="Brisbane Chiropractic Group" />
            </Field>
            <Field label="The offer" hint="One sentence. What are they getting? What does it cost?">
              <input value={intake.offer} onChange={(e) => setIntake({ ...intake, offer: e.target.value })} className={inputCls} placeholder="Free 30-min consult to plan your weight loss program" />
            </Field>
            <Field label="Dream outcome" hint="Specific result, with timeframe.">
              <input value={intake.dream_outcome} onChange={(e) => setIntake({ ...intake, dream_outcome: e.target.value })} className={inputCls} placeholder="Lose 20 lbs in 90 days without giving up your favorite foods" />
            </Field>
            <Field label="False belief blocking them" hint="What have they tried that didn't work?">
              <textarea rows={2} value={intake.false_belief} onChange={(e) => setIntake({ ...intake, false_belief: e.target.value })} className={textareaCls} />
            </Field>
            <Field label="Mechanism — what makes you different" hint="Your unique angle, framework, or process.">
              <textarea rows={2} value={intake.mechanism} onChange={(e) => setIntake({ ...intake, mechanism: e.target.value })} className={textareaCls} />
            </Field>
            <Field label="Proof — track record" hint="Specific numbers + concrete examples.">
              <textarea rows={2} value={intake.proof} onChange={(e) => setIntake({ ...intake, proof: e.target.value })} className={textareaCls} />
            </Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Price (optional)">
                <input value={intake.price ?? ''} onChange={(e) => setIntake({ ...intake, price: e.target.value })} className={inputCls} placeholder="Free / $497" />
              </Field>
              <Field label="Audience (optional)">
                <input value={intake.audience ?? ''} onChange={(e) => setIntake({ ...intake, audience: e.target.value })} className={inputCls} placeholder="Brisbane women, 35–55" />
              </Field>
              <Field label="Industry (optional)">
                <input value={intake.industry ?? ''} onChange={(e) => setIntake({ ...intake, industry: e.target.value })} className={inputCls} placeholder="Health & wellness" />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Brand voice">
                <select value={intake.brand_voice ?? 'friendly'} onChange={(e) => setIntake({ ...intake, brand_voice: e.target.value as Intake['brand_voice'] })} className={inputCls}>
                  <option value="friendly">Friendly</option>
                  <option value="authoritative">Authoritative</option>
                  <option value="playful">Playful</option>
                  <option value="luxury">Luxury</option>
                </select>
              </Field>
              <Field label="Brand color">
                <div className="flex items-center gap-2">
                  <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-12 rounded border border-neutral-300" />
                  <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className={inputCls} />
                </div>
              </Field>
            </div>
          </Card>

          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={btnPrimaryCls}>
              {busy ? 'Creating…' : 'Generate page →'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <Card title="Your generated page" subtitle="Click any section to edit later — for now, regenerate until the structure looks right.">
          {busy && !generated ? (
            <div className="flex h-72 items-center justify-center text-neutral-500">Generating…</div>
          ) : generated ? (
            <div className="space-y-4">
              <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
                <div className="text-xs uppercase tracking-wider text-neutral-500">Page title</div>
                <div className="mt-1 font-semibold">{generated.title}</div>
                <div className="mt-2 text-sm text-neutral-600">{generated.meta_description}</div>
              </div>
              <div className="rounded-md border border-neutral-200 bg-white">
                <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500">
                  {generated.spec.sections.length} sections
                </div>
                <ul className="divide-y divide-neutral-100">
                  {generated.spec.sections.map((s, i) => (
                    <li key={i} className="px-4 py-3">
                      <div className="text-xs uppercase tracking-wider text-neutral-500">{s.type}</div>
                      {s.headline && <div className="mt-0.5 text-sm font-medium">{s.headline}</div>}
                      {s.body && <div className="mt-1 text-xs text-neutral-600 line-clamp-2">{s.body}</div>}
                    </li>
                  ))}
                </ul>
              </div>
              <button type="button" onClick={() => campaignId && void generatePage(campaignId)} disabled={busy} className={btnSecondaryCls}>
                {busy ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          ) : (
            <div className="text-sm text-neutral-500">No page yet.</div>
          )}
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(1)} className={btnGhostCls}>← Back</button>
            <button type="button" disabled={!generated || busy} onClick={() => setStep(3)} className={btnPrimaryCls}>
              Next: Agents →
            </button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="Configure response" subtitle="The triggered agent fires within seconds; the conversational agent calls back to qualify and book.">
          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Triggered agent (instant SMS)">
              <select value={triggeredAgentId} onChange={(e) => setTriggeredAgentId(e.target.value)} className={inputCls}>
                <option value="">— None (skip) —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-neutral-500">Sends the moment the form is submitted.</p>
            </Field>
            <Field label="Conversational agent (callback)">
              <select value={conversationalAgentId} onChange={(e) => setConversationalAgentId(e.target.value)} className={inputCls}>
                <option value="">— None (skip) —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="mt-1 text-xs text-neutral-500">Calls back, qualifies, and books appointments.</p>
            </Field>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Don&rsquo;t see the agent you want?{' '}
            <Link href={`/dashboard/${workspaceId}/agents/new`} className="underline">
              Create a new agent
            </Link>{' '}
            in another tab and refresh.
          </p>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(2)} className={btnGhostCls}>← Back</button>
            <button type="button" onClick={submitStep3} disabled={busy} className={btnPrimaryCls}>
              {busy ? 'Saving…' : 'Next: Tracking →'}
            </button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Conversion tracking" subtitle="Server-side conversion events fire to Meta CAPI + Google Ads at every funnel stage. The ad platforms then optimize on bookings, not just clicks. This is the part most advertisers get wrong; we wire it up automatically.">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <Field label="Meta Pixel ID" hint="Find in Meta Events Manager → Data Sources.">
                <input value={metaPixelId} onChange={(e) => setMetaPixelId(e.target.value)} className={inputCls} placeholder="e.g. 1234567890" />
              </Field>
            </div>
            <div className="space-y-3">
              <Field label="Google conversion ID" hint="e.g. AW-123456789">
                <input value={googleConversionId} onChange={(e) => setGoogleConversionId(e.target.value)} className={inputCls} placeholder="AW-123456789" />
              </Field>
              <Field label="Google conversion action ID" hint="The numeric ID of the conversion action.">
                <input value={googleConversionLabel} onChange={(e) => setGoogleConversionLabel(e.target.value)} className={inputCls} placeholder="123456789" />
              </Field>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            You can skip this step and configure tracking later. Without it, the ad platforms can&rsquo;t optimize on downstream events.
          </p>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(3)} className={btnGhostCls}>← Back</button>
            <button type="button" onClick={submitStep4} disabled={busy} className={btnPrimaryCls}>
              {busy ? 'Publishing…' : 'Publish funnel'}
            </button>
          </div>
        </Card>
      )}

      {step === 5 && publishedUrl && (
        <Card title="Funnel is live" subtitle="The landing page is published, the form is wired, and conversion tracking is firing.">
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
            <div className="text-xs uppercase tracking-wider text-neutral-500">Landing URL</div>
            <a href={publishedUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-sm text-blue-600 hover:underline">
              {publishedUrl}
            </a>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Link href={`/dashboard/${workspaceId}/funnels`} className={btnGhostCls}>
              Back to funnels
            </Link>
            {campaignId && (
              <button type="button" onClick={() => router.push(`/dashboard/${workspaceId}/funnels/${campaignId}`)} className={btnPrimaryCls}>
                Open campaign dashboard
              </button>
            )}
          </div>
        </Card>
      )}
    </main>
  )
}

// ─── small UI primitives ────────────────────────────────────────────

function Stepper({ step }: { step: Step }) {
  const labels: Record<Step, string> = { 1: 'Intake', 2: 'Page', 3: 'Agents', 4: 'Tracking', 5: 'Publish' }
  const numbers: Step[] = [1, 2, 3, 4, 5]
  return (
    <div className="flex items-center gap-2 overflow-x-auto rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
      {numbers.map((n, i) => {
        const active = step === n
        const done = step > n
        return (
          <div key={n} className="flex items-center gap-2">
            <div className={`flex h-7 items-center gap-2 rounded-full px-3 font-medium ${done ? 'bg-blue-100 text-blue-700' : active ? 'bg-blue-600 text-white' : 'text-neutral-400'}`}>
              <span>{n}.</span>
              <span>{labels[n]}</span>
            </div>
            {i < numbers.length - 1 && <div className={`h-px w-6 ${done ? 'bg-blue-300' : 'bg-neutral-200'}`} />}
          </div>
        )
      })}
    </div>
  )
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-6">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      {props.subtitle && <p className="mt-1 text-sm text-neutral-600">{props.subtitle}</p>}
      <div className="mt-5 space-y-4">{props.children}</div>
    </section>
  )
}

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-900">{props.label}</label>
      <div className="mt-1">{props.children}</div>
      {props.hint && <p className="mt-1 text-xs text-neutral-500">{props.hint}</p>}
    </div>
  )
}

const inputCls = 'block h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const textareaCls = 'block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const btnPrimaryCls = 'inline-flex h-10 items-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60'
const btnSecondaryCls = 'inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-50 disabled:opacity-60'
const btnGhostCls = 'inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-100'
