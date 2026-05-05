'use client'

/**
 * Funnel creation wizard — 5 steps.
 *
 * Styled with Voxility design tokens (var(--surface), var(--accent-primary)
 * etc.) — never hardcoded Tailwind color utilities. Mirrors the visual
 * language of the rest of the dashboard (calls, agents pages).
 */

import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
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

interface AgentRow { id: string; name: string }

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

// ─── Design-token style helpers ────────────────────────────────────────

const surface: CSSProperties = {
  background: 'var(--surface)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}

const inputStyle: CSSProperties = {
  background: 'var(--input-bg)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--input-border)',
  color: 'var(--input-text)',
}

const btnPrimary: CSSProperties = {
  background: 'var(--accent-primary)',
  color: 'var(--btn-primary-text)',
}

const btnSecondary: CSSProperties = {
  background: 'var(--surface-secondary)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
}

const btnGhost: CSSProperties = {
  color: 'var(--text-secondary)',
}

const inputCls = 'block h-10 w-full rounded-lg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1'
const textareaCls = 'block w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-offset-1'
const btnPrimaryCls = 'inline-flex h-10 items-center rounded-lg px-5 text-sm font-medium transition-colors disabled:opacity-60'
const btnSecondaryCls = 'inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-60'
const btnGhostCls = 'inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium transition-colors hover:underline'

// ─── Component ─────────────────────────────────────────────────────────

export default function NewFunnelWizard() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const workspaceId = params.workspaceId

  const [step, setStep] = useState<Step>(1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [access, setAccess] = useState<{ allowed: boolean; reason?: string; currentPlan?: string } | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    fetch(`/api/workspaces/${workspaceId}/funnels`)
      .then((r) => r.json() as Promise<{ access: { allowed: boolean; reason?: string; currentPlan?: string } }>)
      .then((d) => setAccess(d.access))
      .catch(() => setAccess({ allowed: false, reason: 'unknown' }))
  }, [workspaceId])

  // Step 1
  const [name, setName] = useState('')
  const [goal, setGoal] = useState<Goal>('lead_gen')
  const [intake, setIntake] = useState<Intake>({
    business_name: '', offer: '', dream_outcome: '', false_belief: '',
    mechanism: '', proof: '', price: '', audience: '', industry: '',
    brand_voice: 'friendly',
  })
  const [primaryColor, setPrimaryColor] = useState('#e84425')

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

  useEffect(() => {
    if (step !== 3 || agents.length > 0) return
    fetch(`/api/workspaces/${workspaceId}/agents`)
      .then((r) => r.json() as Promise<{ agents?: { id: string; name: string }[] }>)
      .then((d) => setAgents((d.agents ?? []).map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => {})
  }, [step, workspaceId, agents.length])

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

  async function submitStep1(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !intake.business_name.trim() || !intake.offer.trim() || !intake.dream_outcome.trim()) {
      setError('Name, business, offer, and dream outcome are required.')
      return
    }
    setBusy(true)
    try {
      const created = await fetch(`/api/workspaces/${workspaceId}/funnels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, goal, offer_summary: intake.offer, intake,
          brand_voice: intake.brand_voice, primary_color: primaryColor,
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

  // ─── Paywall ─────────────────────────────────────────────────────────
  if (access && !access.allowed) {
    return (
      <main className="mx-auto w-full max-w-2xl px-6 py-20">
        <div
          className="rounded-xl p-8 text-center"
          style={{
            background: 'var(--accent-amber-bg)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--border)',
          }}
        >
          <h1 className="text-xl font-semibold" style={{ color: 'var(--accent-amber)' }}>
            {access.reason === 'trial_expired' ? 'Your trial has expired' : 'Funnel builder requires Growth or Scale'}
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            {access.reason === 'trial_expired'
              ? 'Upgrade to keep using the funnel builder. Existing funnels stay accessible.'
              : `You're on the ${access.currentPlan ?? 'free'} plan. Funnels are available on Growth and Scale.`}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href={`/dashboard/${workspaceId}/funnels`}
              className={btnSecondaryCls}
              style={btnSecondary}
            >
              Back to funnels
            </Link>
            <Link
              href={`/dashboard/${workspaceId}/settings/billing`}
              className={btnPrimaryCls}
              style={btnPrimary}
            >
              Upgrade plan
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <Stepper step={step} />

      {error && (
        <div
          className="mt-6 rounded-lg p-3 text-sm"
          style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {error}
        </div>
      )}

      {step === 1 && (
        <form onSubmit={submitStep1} className="mt-6 space-y-6">
          <Card title="Tell us about the campaign" subtitle="This drives the AI page generator. Be specific — vague inputs make vague pages.">
            <Field label="Campaign name" hint="Internal — not shown to leads.">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} style={inputStyle} placeholder="e.g. Brisbane chiro — Q3" />
            </Field>
            <Field label="Goal">
              <div className="grid gap-2 md:grid-cols-3">
                {GOALS.map((g) => {
                  const active = goal === g.value
                  return (
                    <button
                      type="button"
                      key={g.value}
                      onClick={() => setGoal(g.value)}
                      className="rounded-lg p-3 text-left text-sm transition-colors"
                      style={{
                        background: active ? 'var(--accent-primary-bg)' : 'var(--surface-secondary)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: active ? 'var(--accent-primary)' : 'var(--border)',
                        color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                      }}
                    >
                      {g.label}
                    </button>
                  )
                })}
              </div>
            </Field>
          </Card>

          <Card title="The 6-question intake">
            <Field label="Business name">
              <input value={intake.business_name} onChange={(e) => setIntake({ ...intake, business_name: e.target.value })} className={inputCls} style={inputStyle} placeholder="Brisbane Chiropractic Group" />
            </Field>
            <Field label="The offer" hint="One sentence. What are they getting? What does it cost?">
              <input value={intake.offer} onChange={(e) => setIntake({ ...intake, offer: e.target.value })} className={inputCls} style={inputStyle} placeholder="Free 30-min consult to plan your weight loss program" />
            </Field>
            <Field label="Dream outcome" hint="Specific result, with timeframe.">
              <input value={intake.dream_outcome} onChange={(e) => setIntake({ ...intake, dream_outcome: e.target.value })} className={inputCls} style={inputStyle} placeholder="Lose 20 lbs in 90 days without giving up your favorite foods" />
            </Field>
            <Field label="False belief blocking them" hint="What have they tried that didn't work?">
              <textarea rows={2} value={intake.false_belief} onChange={(e) => setIntake({ ...intake, false_belief: e.target.value })} className={textareaCls} style={inputStyle} />
            </Field>
            <Field label="Mechanism — what makes you different" hint="Your unique angle, framework, or process.">
              <textarea rows={2} value={intake.mechanism} onChange={(e) => setIntake({ ...intake, mechanism: e.target.value })} className={textareaCls} style={inputStyle} />
            </Field>
            <Field label="Proof — track record" hint="Specific numbers + concrete examples.">
              <textarea rows={2} value={intake.proof} onChange={(e) => setIntake({ ...intake, proof: e.target.value })} className={textareaCls} style={inputStyle} />
            </Field>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Price (optional)">
                <input value={intake.price ?? ''} onChange={(e) => setIntake({ ...intake, price: e.target.value })} className={inputCls} style={inputStyle} placeholder="Free / $497" />
              </Field>
              <Field label="Audience (optional)">
                <input value={intake.audience ?? ''} onChange={(e) => setIntake({ ...intake, audience: e.target.value })} className={inputCls} style={inputStyle} placeholder="Brisbane women, 35–55" />
              </Field>
              <Field label="Industry (optional)">
                <input value={intake.industry ?? ''} onChange={(e) => setIntake({ ...intake, industry: e.target.value })} className={inputCls} style={inputStyle} placeholder="Health & wellness" />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Brand voice">
                <select value={intake.brand_voice ?? 'friendly'} onChange={(e) => setIntake({ ...intake, brand_voice: e.target.value as Intake['brand_voice'] })} className={inputCls} style={inputStyle}>
                  <option value="friendly">Friendly</option>
                  <option value="authoritative">Authoritative</option>
                  <option value="playful">Playful</option>
                  <option value="luxury">Luxury</option>
                </select>
              </Field>
              <Field label="Brand color">
                <div className="flex items-center gap-2">
                  <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-12 rounded-lg" style={inputStyle} />
                  <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className={inputCls} style={inputStyle} />
                </div>
              </Field>
            </div>
          </Card>

          <div className="flex justify-end">
            <button type="submit" disabled={busy} className={btnPrimaryCls} style={btnPrimary}>
              {busy ? 'Creating…' : 'Generate page →'}
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <Card title="Your generated page" subtitle="Click any section to edit later — for now, regenerate until the structure looks right.">
          {busy && !generated ? (
            <div className="flex h-72 items-center justify-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Generating…
            </div>
          ) : generated ? (
            <div className="space-y-4">
              <div className="rounded-lg p-4" style={{ background: 'var(--surface-secondary)' }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Page title</div>
                <div className="mt-1 font-semibold" style={{ color: 'var(--text-primary)' }}>{generated.title}</div>
                <div className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>{generated.meta_description}</div>
              </div>
              <div className="rounded-lg" style={surface}>
                <div
                  className="px-4 py-2 text-xs"
                  style={{
                    background: 'var(--surface-secondary)',
                    color: 'var(--text-tertiary)',
                    borderTopLeftRadius: '0.5rem',
                    borderTopRightRadius: '0.5rem',
                    borderBottomWidth: '1px',
                    borderBottomStyle: 'solid',
                    borderBottomColor: 'var(--border)',
                  }}
                >
                  {generated.spec.sections.length} sections
                </div>
                <ul>
                  {generated.spec.sections.map((s, i) => (
                    <li
                      key={i}
                      className="px-4 py-3"
                      style={{
                        borderTopWidth: i === 0 ? '0' : '1px',
                        borderTopStyle: 'solid',
                        borderTopColor: 'var(--border)',
                      }}
                    >
                      <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{s.type}</div>
                      {s.headline && <div className="mt-0.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{s.headline}</div>}
                      {s.body && <div className="mt-1 text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{s.body}</div>}
                    </li>
                  ))}
                </ul>
              </div>
              <button type="button" onClick={() => campaignId && void generatePage(campaignId)} disabled={busy} className={btnSecondaryCls} style={btnSecondary}>
                {busy ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>
          ) : (
            <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No page yet.</div>
          )}
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(1)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button type="button" disabled={!generated || busy} onClick={() => setStep(3)} className={btnPrimaryCls} style={btnPrimary}>
              Next: Agents →
            </button>
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="Configure response" subtitle="The triggered agent fires within seconds; the conversational agent calls back to qualify and book.">
          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Triggered agent (instant SMS)">
              <select value={triggeredAgentId} onChange={(e) => setTriggeredAgentId(e.target.value)} className={inputCls} style={inputStyle}>
                <option value="">— None (skip) —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>Sends the moment the form is submitted.</p>
            </Field>
            <Field label="Conversational agent (callback)">
              <select value={conversationalAgentId} onChange={(e) => setConversationalAgentId(e.target.value)} className={inputCls} style={inputStyle}>
                <option value="">— None (skip) —</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>Calls back, qualifies, and books appointments.</p>
            </Field>
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Don&rsquo;t see the agent you want?{' '}
            <Link href={`/dashboard/${workspaceId}/agents/new`} className="underline" style={{ color: 'var(--accent-primary)' }}>
              Create a new agent
            </Link>{' '}
            in another tab and refresh.
          </p>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(2)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button type="button" onClick={submitStep3} disabled={busy} className={btnPrimaryCls} style={btnPrimary}>
              {busy ? 'Saving…' : 'Next: Tracking →'}
            </button>
          </div>
        </Card>
      )}

      {step === 4 && (
        <Card title="Conversion tracking" subtitle="Server-side conversion events fire to Meta CAPI + Google Ads at every funnel stage. The ad platforms then optimize on bookings, not just clicks.">
          <div className="grid gap-6 md:grid-cols-2">
            <Field label="Meta Pixel ID" hint="Find in Meta Events Manager → Data Sources.">
              <input value={metaPixelId} onChange={(e) => setMetaPixelId(e.target.value)} className={inputCls} style={inputStyle} placeholder="e.g. 1234567890" />
            </Field>
            <div className="space-y-3">
              <Field label="Google conversion ID" hint="e.g. AW-123456789">
                <input value={googleConversionId} onChange={(e) => setGoogleConversionId(e.target.value)} className={inputCls} style={inputStyle} placeholder="AW-123456789" />
              </Field>
              <Field label="Google conversion action ID" hint="The numeric ID of the conversion action.">
                <input value={googleConversionLabel} onChange={(e) => setGoogleConversionLabel(e.target.value)} className={inputCls} style={inputStyle} placeholder="123456789" />
              </Field>
            </div>
          </div>
          <p className="mt-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            You can skip this step and configure tracking later. Without it, the ad platforms can&rsquo;t optimize on downstream events.
          </p>
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(3)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button type="button" onClick={submitStep4} disabled={busy} className={btnPrimaryCls} style={btnPrimary}>
              {busy ? 'Publishing…' : 'Publish funnel'}
            </button>
          </div>
        </Card>
      )}

      {step === 5 && publishedUrl && (
        <Card title="Funnel is live" subtitle="The landing page is published, the form is wired, and conversion tracking is firing.">
          <div className="rounded-lg p-4" style={{ background: 'var(--surface-secondary)' }}>
            <div className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Landing URL</div>
            <a href={publishedUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
              {publishedUrl}
            </a>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <Link href={`/dashboard/${workspaceId}/funnels`} className={btnSecondaryCls} style={btnSecondary}>
              Back to funnels
            </Link>
            {campaignId && (
              <button type="button" onClick={() => router.push(`/dashboard/${workspaceId}/funnels/${campaignId}`)} className={btnPrimaryCls} style={btnPrimary}>
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
    <div
      className="flex items-center gap-2 overflow-x-auto rounded-xl p-3 text-sm"
      style={{
        background: 'var(--surface-secondary)',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: 'var(--border)',
      }}
    >
      {numbers.map((n, i) => {
        const active = step === n
        const done = step > n
        const fg = active ? 'var(--btn-primary-text)' : done ? 'var(--accent-primary)' : 'var(--text-muted)'
        const bg = active ? 'var(--accent-primary)' : done ? 'var(--accent-primary-bg)' : 'transparent'
        return (
          <div key={n} className="flex items-center gap-2">
            <div className="flex h-7 items-center gap-2 rounded-full px-3 font-medium" style={{ background: bg, color: fg }}>
              <span>{n}.</span>
              <span>{labels[n]}</span>
            </div>
            {i < numbers.length - 1 && (
              <div className="h-px w-6" style={{ background: done ? 'var(--accent-primary-bg)' : 'var(--border)' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Card(props: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl p-6" style={surface}>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{props.title}</h2>
      {props.subtitle && <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>{props.subtitle}</p>}
      <div className="mt-5 space-y-4">{props.children}</div>
    </section>
  )
}

function Field(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{props.label}</label>
      <div className="mt-1">{props.children}</div>
      {props.hint && <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>{props.hint}</p>}
    </div>
  )
}
