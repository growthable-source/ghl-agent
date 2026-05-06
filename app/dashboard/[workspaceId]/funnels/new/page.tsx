'use client'

/**
 * Funnel creation wizard — 5 steps.
 *
 * Styled with Voxility design tokens (var(--surface), var(--accent-primary)
 * etc.) — never hardcoded Tailwind color utilities. Mirrors the visual
 * language of the rest of the dashboard (calls, agents pages).
 */

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { GeneratingAnimation } from './GeneratingAnimation'
import {
  BuildTimeline,
  type BuildState,
  type BuildIteration,
} from '@/components/funnels/BuildTimeline'

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

interface GeneratedSpec {
  version?: 1
  style?: { primary_color?: string }
  sections?: { type: string; headline?: string; body?: string }[]
  images?: { hero_url?: string; offer_bg_url?: string; og_url?: string }
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
// 6-step wizard: Brand (new) → Intake → Page → Agents → Tracking → Publish.
// Brand-step inputs (logo upload, reference website, brand guide,
// extracted colours) feed both the Claude generator and the Gemini
// image prompts so generated pages stay on-brand.
type Step = 1 | 2 | 3 | 4 | 5 | 6

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

// ─── Brand-step helpers ────────────────────────────────────────────────

/** De-dup hex strings case-insensitively while preserving order. */
function mergeUnique(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of arr) {
    const key = c.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(c.trim())
  }
  return out
}

/**
 * Sample dominant non-grey colours from an image URL via canvas.
 * Returns up to 3 hex strings sorted by frequency. Best-effort —
 * throws on CORS / decode failures and the caller swallows.
 *
 * Algorithm: bucket each pixel into 16-step quantised RGB, count
 * buckets, drop near-grey/near-white/near-black, sort, top-N.
 */
async function extractColorsFromImage(url: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return resolve([])
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onerror = () => reject(new Error('image load failed'))
    img.onload = () => {
      try {
        const target = 80 // small canvas, good enough for colour signal
        const w = target
        const h = Math.round((img.naturalHeight / img.naturalWidth) * target) || target
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('no canvas ctx'))
        ctx.drawImage(img, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        const counts = new Map<string, number>()
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3]
          if (a < 200) continue
          const r = data[i] & 0xf0
          const g = data[i + 1] & 0xf0
          const b = data[i + 2] & 0xf0
          const lum = (r + g + b) / 3
          if (lum < 25 || lum > 235) continue
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          if (max - min < 18) continue
          const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
          counts.set(hex, (counts.get(hex) ?? 0) + 1)
        }
        const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k)
        resolve(top)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    img.src = url
  })
}

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
    // Lightweight diagnostic — has GEMINI_API_KEY been wired in Vercel?
    // Endpoint returns { enabled: bool } without leaking key material.
    fetch(`/api/workspaces/${workspaceId}/funnels/image-gen-status`)
      .then((r) => r.json() as Promise<{ enabled: boolean }>)
      .then((d) => setImageGenAvailable(d.enabled))
      .catch(() => setImageGenAvailable(false))
  }, [workspaceId])

  // ─── Brand-step handlers ───────────────────────────────────────────
  async function uploadLogo(file: File) {
    setLogoUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/brand-asset-upload`, { method: 'POST', body: form })
      if (!r.ok) {
        // Read the body as text once so we can surface either parsed
        // JSON `error` fields OR the raw HTML/text Vercel returns when
        // a serverless function 500s (e.g. missing BLOB token). Without
        // this the operator just sees "Upload failed" and has to read
        // logs to find out why.
        const raw = await r.text().catch(() => '')
        let detail = `HTTP ${r.status}`
        try {
          const json = JSON.parse(raw)
          if (json?.error) detail = json.error
          else if (json?.message) detail = json.message
        } catch {
          // Strip HTML tags + truncate so a Vercel error page renders cleanly.
          const stripped = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
          if (stripped) detail = stripped.slice(0, 240)
        }
        console.error('[brand upload] failed:', r.status, raw.slice(0, 500))
        throw new Error(`Logo upload failed (${detail})`)
      }
      const { logoUrl } = (await r.json()) as { logoUrl: string }
      setLogoUrl(logoUrl)
      // Sample dominant non-grey colours from the logo via canvas.
      // Best-effort — failures are silent (operator can pick a colour
      // by hand on the next step).
      try {
        const colours = await extractColorsFromImage(logoUrl)
        if (colours.length > 0) {
          setExtractedColors((prev) => mergeUnique([...colours, ...prev]).slice(0, 6))
          // Auto-pick the first vibrant colour as the primary, but don't
          // overwrite if the operator has already picked one manually.
          if (primaryColor === '#e84425') setPrimaryColor(colours[0])
        }
      } catch {
        // canvas failures (CORS on the Blob URL, exotic image format) are
        // not worth surfacing — colour pickers below still work.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logo upload failed')
    } finally {
      setLogoUploading(false)
    }
  }

  // Brand scrape now runs implicitly server-side on funnel-create when a
  // reference_url is set. The vision pipeline output (screenshot +
  // analysis) lands on the Campaign row and feeds the build loop's
  // critique. The wizard no longer needs a manual "Pull brand" button.

  // Step 1 — Brand (new)
  // 'gradient' is the better default: most landing pages look better
  // with a Stripe-style gradient + huge typography hero than with
  // mediocre AI photography. AI photo is opt-in, ~$0.06/page extra.
  const [heroStyle, setHeroStyle] = useState<'gradient' | 'ai_photo'>('gradient')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [referenceUrl, setReferenceUrl] = useState('')
  const [brandGuideText, setBrandGuideText] = useState('')
  const [extractedColors, setExtractedColors] = useState<string[]>([])
  // Whether GEMINI_API_KEY is set on the deployment (read-only fact;
  // operator can't fix from here, but we surface a warning so the
  // 'no images on my page' question doesn't keep coming back).
  const [imageGenAvailable, setImageGenAvailable] = useState<boolean | null>(null)

  // Step 2 — Intake
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

  // Build loop — replaces the old single-shot generate. Build state +
  // a polling flag drive the timeline UI on step 3. Selected iteration
  // is what gets published in step 5 (defaults to the build's bestIterationId).
  const [build, setBuild] = useState<BuildState | null>(null)
  const [buildPolling, setBuildPolling] = useState(false)
  const [selectedIterationId, setSelectedIterationId] = useState<string | null>(null)

  // Convenience derivation: the iteration the operator has selected,
  // and its title/meta/spec for the publish step.
  const selectedIteration = useMemo<BuildIteration | null>(
    () => build?.iterations.find((i) => i.id === selectedIterationId) ?? null,
    [build, selectedIterationId],
  )
  const selectedSnapshot = useMemo(() => {
    const raw = (selectedIteration as { specSnapshot?: unknown })?.specSnapshot
    if (!raw || typeof raw !== 'object') return null
    const obj = raw as { title?: string; meta_description?: string; spec?: GeneratedSpec }
    if (!obj.spec) return null
    return { title: obj.title ?? name, meta_description: obj.meta_description ?? '', spec: obj.spec }
  }, [selectedIteration, name])

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

  // Build polling — while step 3 is showing the build timeline AND
  // the build is still running, refresh every 2s so iteration cards
  // appear as Browserbase + the critic finish each one. The polling
  // flag is set true by kickOffBuild and false by refreshBuild once
  // the build hits a terminal state.
  useEffect(() => {
    if (step !== 3 || !campaignId || !buildPolling) return
    let cancelled = false
    const tick = async () => {
      const next = await refreshBuild(campaignId)
      if (cancelled) return
      if (next && (next.status === 'passed' || next.status === 'capped' || next.status === 'failed')) {
        return // refreshBuild already cleared buildPolling
      }
      window.setTimeout(tick, 2000)
    }
    void tick()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, campaignId, buildPolling])

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

  async function submitIntake(e: FormEvent) {
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
          // Brand kit captured on Step 1 — flows through to the
          // Campaign row + Claude system prompt + Gemini image prompts.
          logo_url: logoUrl,
          brand_guide_text: brandGuideText.trim() || null,
          reference_url: referenceUrl.trim() || null,
          extracted_colors: extractedColors,
        }),
      })
      if (!created.ok) throw new Error((await created.json()).error ?? 'Create failed')
      const { campaign } = (await created.json()) as { campaign: { id: string } }
      setCampaignId(campaign.id)
      setStep(3)
      void kickOffBuild(campaign.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function kickOffBuild(forCampaignId: string) {
    setBuild(null)
    setSelectedIterationId(null)
    setBuildPolling(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${forCampaignId}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!r.ok && r.status !== 409) {
        throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not start build')
      }
      // 409 means a build is already running — poll picks it up.
      // Initial fetch to populate the timeline immediately.
      await refreshBuild(forCampaignId)
    } catch (err) {
      setBuildPolling(false)
      setError(err instanceof Error ? err.message : 'Build failed to start')
    }
  }

  async function refreshBuild(forCampaignId: string): Promise<BuildState | null> {
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${forCampaignId}/build`)
      if (!r.ok) return null
      const data = (await r.json()) as { build: BuildState | null }
      const next = data.build
      if (next) {
        setBuild(next)
        // Auto-select the best iteration once the build is in a
        // terminal state, unless the operator already picked one.
        const terminal = next.status === 'passed' || next.status === 'capped' || next.status === 'failed'
        if (terminal) {
          setBuildPolling(false)
          setSelectedIterationId((prev) => prev ?? next.bestIterationId ?? null)
        }
      }
      return next
    } catch {
      return null
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
      setStep(5)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function submitStep4() {
    if (!campaignId || !selectedSnapshot) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/funnels/${campaignId}/landing-page`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedSnapshot.title,
          meta_description: selectedSnapshot.meta_description,
          spec: selectedSnapshot.spec,
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
      setStep(6)
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
        <form onSubmit={(e) => { e.preventDefault(); setStep(2) }} className="mt-6 space-y-6">
          {imageGenAvailable === false && (
            <div
              className="rounded-lg p-3 text-sm"
              style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
            >
              <div className="font-medium">AI imagery is off on this deployment.</div>
              <div className="mt-0.5 text-xs">
                Pages will render text-only. Add <code>GEMINI_API_KEY</code> in Vercel → Project → Settings → Environment Variables to enable Gemini hero/OG image generation (~$0.12/page).
              </div>
            </div>
          )}

          <Card
            title="Brand"
            subtitle="Drop in your logo, paste your existing site, and tell us how you sound. The AI uses this for colours, voice, and image generation — not just defaults."
          >
            <Field label="Logo" hint="PNG / JPG / SVG / WebP, up to 2 MB. We'll sample its dominant colour automatically.">
              <div className="flex items-center gap-4">
                {logoUrl ? (
                  <div
                    className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: 'var(--surface-secondary)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }}
                  >
                    <img src={logoUrl} alt="" className="max-h-14 max-w-14 object-contain" />
                  </div>
                ) : (
                  <div
                    className="flex h-16 w-16 items-center justify-center rounded-lg text-xs"
                    style={{ background: 'var(--surface-secondary)', borderWidth: '1px', borderStyle: 'dashed', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                  >
                    No logo
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  disabled={logoUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void uploadLogo(f)
                  }}
                  className="block w-full text-xs"
                  style={{ color: 'var(--text-secondary)' }}
                />
                {logoUploading && <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Uploading…</span>}
              </div>
            </Field>

            <Field
              label="Reference website (optional)"
              hint="Paste your existing site URL. We render it in a real browser, screenshot it, and feed both the screenshot and the extracted brand identity into the page generator AND the iteration loop's design critic — so what gets built actually looks like your brand."
            >
              <input
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                className={inputCls}
                style={inputStyle}
                placeholder="https://yourbusiness.com"
              />
            </Field>

            <Field
              label="Brand guide / voice notes (optional)"
              hint="Paste anything — voice rules, dos/don'ts, sample copy, style guide markdown. The AI reads this verbatim before writing."
            >
              <textarea
                rows={4}
                value={brandGuideText}
                onChange={(e) => setBrandGuideText(e.target.value)}
                className={textareaCls}
                style={inputStyle}
                placeholder={'e.g. "We sound like a friend, not a salesperson. Never use words like ‘unlock’, ‘elevate’, ‘game-changer’. Numbers > adjectives. Always reference our 12-year track record in Brisbane."'}
              />
            </Field>

            {extractedColors.length > 0 && (
              <Field label="Detected colours" hint="Click any swatch to make it the brand primary.">
                <div className="flex flex-wrap gap-2">
                  {extractedColors.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setPrimaryColor(c)}
                      title={c}
                      className="h-9 w-9 rounded-md transition-transform hover:scale-110"
                      style={{
                        background: c,
                        borderWidth: '2px',
                        borderStyle: 'solid',
                        borderColor: primaryColor.toLowerCase() === c.toLowerCase() ? 'var(--text-primary)' : 'var(--border)',
                      }}
                    />
                  ))}
                </div>
              </Field>
            )}

            <Field label="Brand colour" hint="Used everywhere — buttons, headlines, CTAs, image-gen tints.">
              <div className="flex items-center gap-2">
                <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-12 rounded-lg" style={inputStyle} />
                <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className={inputCls} style={inputStyle} />
              </div>
            </Field>

            <Field
              label="Hero style"
              hint="Gradient is usually the better choice — Stripe/Linear-style typography on a brand-color backdrop. AI photo costs ~$0.06 extra and works best for service/consumer brands where a real-feeling photo matters."
            >
              <div className="grid gap-2 md:grid-cols-2">
                {([
                  {
                    value: 'gradient' as const,
                    title: 'Gradient + typography',
                    desc: 'Bold brand-color backdrop, huge headline. No AI photo. Free.',
                  },
                  {
                    value: 'ai_photo' as const,
                    title: 'AI photograph',
                    desc: 'Flux 1.1 Pro Ultra renders a hero photo matched to your brand. ~$0.06.',
                  },
                ]).map((o) => {
                  const active = heroStyle === o.value
                  return (
                    <button
                      type="button"
                      key={o.value}
                      onClick={() => setHeroStyle(o.value)}
                      className="rounded-lg p-3 text-left text-sm transition-colors"
                      style={{
                        background: active ? 'var(--accent-primary-bg)' : 'var(--surface-secondary)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: active ? 'var(--accent-primary)' : 'var(--border)',
                        color: active ? 'var(--accent-primary)' : 'var(--text-primary)',
                      }}
                    >
                      <div className="font-medium">{o.title}</div>
                      <div className="mt-0.5 text-xs" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}>
                        {o.desc}
                      </div>
                    </button>
                  )
                })}
              </div>
            </Field>
          </Card>

          <div className="flex justify-end gap-2">
            <button type="submit" className={btnPrimaryCls} style={btnPrimary}>
              Next: Intake →
            </button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={submitIntake} className="mt-6 space-y-6">
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
            <Field label="Brand voice">
              <select value={intake.brand_voice ?? 'friendly'} onChange={(e) => setIntake({ ...intake, brand_voice: e.target.value as Intake['brand_voice'] })} className={inputCls} style={inputStyle}>
                <option value="friendly">Friendly</option>
                <option value="authoritative">Authoritative</option>
                <option value="playful">Playful</option>
                <option value="luxury">Luxury</option>
              </select>
            </Field>
          </Card>

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button type="submit" disabled={busy} className={btnPrimaryCls} style={btnPrimary}>
              {busy ? 'Creating…' : 'Generate page →'}
            </button>
          </div>
        </form>
      )}

      {step === 3 && (
        <Card
          title={
            buildPolling
              ? 'Building your page'
              : build?.status === 'passed'
                ? 'Your page passed the design review'
                : build?.status === 'capped'
                  ? 'Iteration cap hit — best version selected'
                  : build?.status === 'failed'
                    ? 'Build failed'
                    : 'Building your page'
          }
          subtitle={
            buildPolling
              ? 'Each iteration: render in a real browser, screenshot, vision-critique, regenerate. Stops when the page clears 8/10 or hits the iteration cap.'
              : build?.status === 'passed'
                ? `Cleared the ${build.scoreThreshold}/10 quality bar at iteration ${build.iterations.find(i => i.id === build.bestIterationId)?.iteration ?? 1}. Pick a different iteration below if you'd rather ship that one.`
                : build?.status === 'capped'
                  ? `Ran ${build.iterations.length} iterations and didn't quite clear ${build.scoreThreshold}/10 — the best one (${build.bestScore?.toFixed(1) ?? '—'}) is selected by default. You can still publish; or regenerate from the funnel page.`
                  : 'Click a card to inspect its critique. The selected iteration is what gets published.'
          }
        >
          {!build && buildPolling && <GeneratingAnimation />}
          {build && (
            <BuildTimeline
              build={build}
              selectedIterationId={selectedIterationId}
              onSelect={setSelectedIterationId}
              banner={
                imageGenAvailable === false ? (
                  <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}>
                    AI imagery is off on this deployment — pages render text-only. Add <code>GEMINI_API_KEY</code> to enable hero/OG generation.
                  </div>
                ) : undefined
              }
            />
          )}
          {build?.status === 'failed' && build.error && (
            <div className="mt-4 rounded-lg p-3 text-sm" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
              {build.error}
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <button type="button" onClick={() => setStep(2)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button
              type="button"
              disabled={!selectedSnapshot || buildPolling}
              onClick={() => setStep(4)}
              className={btnPrimaryCls}
              style={btnPrimary}
            >
              {buildPolling ? 'Building…' : 'Next: Agents →'}
            </button>
          </div>
        </Card>
      )}

      {step === 4 && (
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
            <button type="button" onClick={() => setStep(3)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button type="button" onClick={submitStep3} disabled={busy} className={btnPrimaryCls} style={btnPrimary}>
              {busy ? 'Saving…' : 'Next: Tracking →'}
            </button>
          </div>
        </Card>
      )}

      {step === 5 && (
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
            <button type="button" onClick={() => setStep(4)} className={btnGhostCls} style={btnGhost}>← Back</button>
            <button type="button" onClick={submitStep4} disabled={busy} className={btnPrimaryCls} style={btnPrimary}>
              {busy ? 'Publishing…' : 'Publish funnel'}
            </button>
          </div>
        </Card>
      )}

      {step === 6 && publishedUrl && (
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
  const labels: Record<Step, string> = { 1: 'Brand', 2: 'Intake', 3: 'Page', 4: 'Agents', 5: 'Tracking', 6: 'Publish' }
  const numbers: Step[] = [1, 2, 3, 4, 5, 6]
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
