/**
 * Manus-style landing page build loop.
 *
 * Runs end-to-end for one Campaign:
 *   1. Ensure a draft LandingPage exists for the campaign.
 *   2. Generate an initial spec (or read the existing one if rebuilding).
 *   3. For each iteration up to maxIterations:
 *        a. Save the spec onto the LandingPage row (still draft).
 *        b. Sign a preview token; ask Browserbase to render the
 *           page at /p/<slug>?preview=<token>.
 *        c. Upload screenshot to Vercel Blob (operator UI displays it).
 *        d. Sonnet 4.6 vision pass critiques the rendered page.
 *        e. If score >= scoreThreshold → mark passed, exit.
 *        f. Otherwise build a "revision brief" from the critique and
 *           regenerate the spec with it appended.
 *   4. Mark the build as `passed` (cleared threshold), `capped` (ran
 *      out of iterations), or `failed` (unrecoverable error).
 *
 * Each iteration writes a BuildIteration row as it progresses so the
 * wizard's polling UI can show the timeline live: thumbnail appears
 * after render, critique fills in, score lands, then "patching…" until
 * the next iteration shows up.
 *
 * The orchestrator never publishes the page. Operator publishes from
 * the wizard's final step. The build only produces a draft + iteration
 * timeline; the operator chooses which iteration to ship from.
 */

import { put } from '@vercel/blob'
import { db } from './db'
import { generateVslPage, type BrandKit, type CampaignIntake, type PageTemplate } from './vsl-generator'
import { renderLandingPage } from './page-render'
import { critiqueLandingPage, type PageCritique } from './page-critic'
import { signPreviewToken } from './preview-token'
import type { BrandAnalysis } from './brand-vision'
import type { PageSpec } from './page-spec'

interface RunBuildArgs {
  buildId: string
  /** Where the deployed app lives — used to construct the preview URL
   *  Browserbase navigates to. Defaults to the request origin in the
   *  caller; passed in explicitly because Vercel runtimes don't have a
   *  reliable "self" URL otherwise. */
  origin: string
}

/**
 * Drives the full loop for a queued LandingPageBuild row. Mutates DB
 * rows as it goes. Designed to be run inside a long-running serverless
 * function (maxDuration: 800).
 *
 * Errors caught at every step — the loop never throws back to the
 * caller. Failures land on the build row (status='failed', error=...)
 * or on individual iteration rows so partial progress is preserved.
 */
export async function runBuild(args: RunBuildArgs): Promise<void> {
  const build = await db.landingPageBuild.findUnique({
    where: { id: args.buildId },
    select: {
      id: true, workspaceId: true, campaignId: true, status: true,
      maxIterations: true, scoreThreshold: true,
    },
  })
  if (!build) return
  if (build.status !== 'queued') return // already running or done

  await db.landingPageBuild.update({
    where: { id: build.id },
    data: { status: 'running' },
  })

  const ctx = await loadContext(build.campaignId, build.workspaceId)
  if (!ctx) {
    await markFailed(build.id, 'Campaign or brand context could not be loaded.')
    return
  }

  // ─── Ensure a draft LandingPage exists for the campaign ────────────
  const landingPage = await ensureDraftLandingPage({
    workspaceId: build.workspaceId,
    campaignId: build.campaignId,
    campaignName: ctx.campaign.name,
    template: 'vsl',
    createdBy: ctx.campaign.createdBy,
  })
  if (!landingPage) {
    await markFailed(build.id, 'Could not create or find draft LandingPage row.')
    return
  }

  let currentSpec: PageSpec | null = null
  let currentTitle: string = ctx.campaign.name
  let currentMeta: string | null = null
  let previousCritique: PageCritique | null = null
  let bestScore = 0
  let bestIterationId: string | null = null

  for (let iter = 1; iter <= build.maxIterations; iter++) {
    const iteration = await db.buildIteration.create({
      data: { buildId: build.id, iteration: iter, status: 'rendering' },
      select: { id: true },
    })

    // ─── (a) Generate or regenerate the spec ─────────────────────────
    try {
      const revisionBrief = previousCritique
        ? buildRevisionBrief(previousCritique, iter)
        : null

      const generated = await generateVslPage({
        intake: ctx.intake,
        template: 'vsl',
        primary_color: ctx.campaign.primaryColor ?? '#0A84FF',
        brand_kit: ctx.brandKit,
        revision_brief: revisionBrief,
      })
      currentSpec = generated.spec
      currentTitle = generated.title || currentTitle
      currentMeta = generated.meta_description || currentMeta

      await db.landingPage.update({
        where: { id: landingPage.id },
        data: {
          title: currentTitle,
          metaDescription: currentMeta,
          spec: currentSpec as unknown as object,
        },
      })
    } catch (err) {
      await markIterationFailed(iteration.id, `generate: ${errMsg(err)}`)
      // Keep going only if we have a previous spec to render. Iteration
      // 1 fails terminally; later iterations fall back to previous.
      if (iter === 1) { await markFailed(build.id, `Generation failed on iteration 1: ${errMsg(err)}`); return }
      continue
    }

    // ─── (b) Render via Browserbase ──────────────────────────────────
    let rendered: Awaited<ReturnType<typeof renderLandingPage>>
    try {
      const token = signPreviewToken(landingPage.id)
      const previewUrl = `${args.origin}/p/${landingPage.slug}?preview=${encodeURIComponent(token)}`
      rendered = await renderLandingPage(previewUrl)
    } catch (err) {
      await markIterationFailed(iteration.id, `render: ${errMsg(err)}`)
      continue
    }
    if (!rendered.ok) {
      await markIterationFailed(iteration.id, `render: ${rendered.error}`)
      continue
    }

    // Upload first-fold screenshot to Blob so the wizard timeline can
    // show it. Full-page lives only in the vision request, not on disk.
    let screenshotUrl: string | null = null
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const path = `workspaces/${build.workspaceId}/builds/${build.id}/iter-${iter}.png`
        const buf = Buffer.from(rendered.firstFoldBase64, 'base64')
        const blob = await put(path, buf, {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'image/png',
        })
        screenshotUrl = blob.url
      } catch (err) {
        console.warn(`[build ${build.id}] iteration ${iter} blob upload failed:`, errMsg(err))
      }
    }

    await db.buildIteration.update({
      where: { id: iteration.id },
      data: { status: 'critiquing', screenshotUrl },
    })

    // ─── (c) Critique ────────────────────────────────────────────────
    let critique: PageCritique
    try {
      critique = await critiqueLandingPage({
        firstFoldBase64: rendered.firstFoldBase64,
        fullPageBase64: rendered.fullPageBase64,
        screenshotMime: 'image/png',
        intake: ctx.intake,
        primaryColor: ctx.campaign.primaryColor ?? '#0A84FF',
        brandAnalysis: ctx.brandAnalysis,
        brandReferenceScreenshotUrl: ctx.brandScreenshotUrl,
        consoleErrors: rendered.consoleErrors,
        networkErrors: rendered.networkErrors,
        iterationNumber: iter,
        previousCritique,
        scoreThreshold: build.scoreThreshold,
      })
    } catch (err) {
      await markIterationFailed(iteration.id, `critique: ${errMsg(err)}`)
      continue
    }

    await db.buildIteration.update({
      where: { id: iteration.id },
      data: {
        status: 'complete',
        critique: critique as unknown as object,
        score: critique.score,
        // specSnapshot intentionally carries title + meta_description
        // alongside the spec so the wizard can publish a non-final
        // iteration without a separate lookup.
        specSnapshot: { title: currentTitle, meta_description: currentMeta, spec: currentSpec } as unknown as object,
        completedAt: new Date(),
      },
    })

    // Track the best iteration so the build row points at it for the UI.
    if (critique.score > bestScore) {
      bestScore = critique.score
      bestIterationId = iteration.id
      await db.landingPageBuild.update({
        where: { id: build.id },
        data: { bestScore, bestIterationId },
      })
    }

    previousCritique = critique

    // ─── (d) Stop early if we cleared the threshold ──────────────────
    if (critique.pass) {
      await db.landingPageBuild.update({
        where: { id: build.id },
        data: { status: 'passed', completedAt: new Date() },
      })
      return
    }

    // Otherwise loop into the next iteration with the critique baked
    // into the next regeneration's revision brief.
  }

  // Ran out of iterations without clearing the threshold. Soft cap —
  // the best iteration is still usable; the operator picks one.
  await db.landingPageBuild.update({
    where: { id: build.id },
    data: { status: 'capped', completedAt: new Date() },
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface BuildContext {
  campaign: {
    id: string
    name: string
    primaryColor: string | null
    createdBy: string
    landingPageId: string | null
  }
  intake: CampaignIntake
  brandKit: BrandKit
  brandAnalysis: BrandAnalysis | null
  brandScreenshotUrl: string | null
}

async function loadContext(campaignId: string, workspaceId: string): Promise<BuildContext | null> {
  const c = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      id: true, workspaceId: true, name: true, primaryColor: true, createdBy: true, landingPageId: true,
      offerSummary: true, intake: true, brandVoice: true,
      logoUrl: true, brandGuideText: true, referenceUrl: true, extractedColors: true,
      brandScreenshotUrl: true, brandAnalysis: true,
    },
  })
  if (!c || c.workspaceId !== workspaceId) return null

  // Intake: stored as Json on Campaign. Fall back to offerSummary as the
  // bare-minimum offer field if the wizard didn't send a structured intake.
  const rawIntake = (c.intake as Record<string, unknown> | null) ?? {}
  const intake: CampaignIntake = {
    business_name: str(rawIntake.business_name) ?? c.name,
    offer: str(rawIntake.offer) ?? c.offerSummary ?? '',
    dream_outcome: str(rawIntake.dream_outcome) ?? '',
    false_belief: str(rawIntake.false_belief) ?? '',
    mechanism: str(rawIntake.mechanism) ?? '',
    proof: str(rawIntake.proof) ?? '',
    price: str(rawIntake.price),
    audience: str(rawIntake.audience),
    industry: str(rawIntake.industry),
    brand_voice: brandVoiceOr(str(rawIntake.brand_voice) ?? c.brandVoice, 'friendly'),
  }

  const brandAnalysis = c.brandAnalysis ? (c.brandAnalysis as unknown as BrandAnalysis) : null

  const brandKit: BrandKit = {
    logo_url: c.logoUrl,
    brand_guide_text: c.brandGuideText,
    reference_url: c.referenceUrl,
    extracted_colors: c.extractedColors ?? [],
    text_samples: undefined,
    screenshot_url: c.brandScreenshotUrl,
    analysis: brandAnalysis ?? undefined,
  }

  return {
    campaign: {
      id: c.id,
      name: c.name,
      primaryColor: c.primaryColor,
      createdBy: c.createdBy,
      landingPageId: c.landingPageId,
    },
    intake,
    brandKit,
    brandAnalysis,
    brandScreenshotUrl: c.brandScreenshotUrl,
  }
}

interface DraftLandingPageArgs {
  workspaceId: string
  campaignId: string
  campaignName: string
  template: PageTemplate
  createdBy: string
}

async function ensureDraftLandingPage(args: DraftLandingPageArgs): Promise<{ id: string; slug: string } | null> {
  // Reuse the campaign's existing landing page if it has one.
  const existing = await db.campaign.findUnique({
    where: { id: args.campaignId },
    select: { landingPageId: true },
  })
  if (existing?.landingPageId) {
    const lp = await db.landingPage.findUnique({
      where: { id: existing.landingPageId },
      select: { id: true, slug: true },
    })
    if (lp) return lp
  }

  const slug = await claimSlug(args.campaignName)

  const created = await db.landingPage.create({
    data: {
      workspaceId: args.workspaceId,
      template: args.template,
      slug,
      title: args.campaignName,
      spec: {},
      formSchema: {},
      published: false,
      createdBy: args.createdBy,
    },
    select: { id: true, slug: true },
  })

  await db.campaign.update({
    where: { id: args.campaignId },
    data: { landingPageId: created.id },
  })

  return created
}

async function claimSlug(base: string): Promise<string> {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'page'
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = attempt === 0
      ? cleaned
      : `${cleaned.slice(0, 44)}-${Math.random().toString(36).slice(2, 7)}`
    const taken = await db.landingPage.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!taken) return candidate
  }
  throw new Error('Could not allocate landing page slug after 12 attempts')
}

/**
 * Format the previous iteration's critique into a concrete revision brief
 * the generator can act on. The brief is opinionated about *what* to
 * change — vague feedback like "improve the hero" produces vague rewrites.
 */
function buildRevisionBrief(critique: PageCritique, nextIteration: number): string {
  const issuesByPriority = [...critique.issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  const lines: string[] = []
  lines.push(`REVISION BRIEF — iteration ${nextIteration}.`)
  lines.push(`The previous iteration scored ${critique.score.toFixed(1)}/10 from a senior conversion designer's review. Apply EVERY fix below in this regeneration. Do not regress the strengths.`)
  lines.push('')
  lines.push(`Designer's summary of what's wrong: ${critique.summary}`)
  lines.push('')
  lines.push('FIXES TO APPLY (highest priority first):')
  for (const issue of issuesByPriority) {
    lines.push(`• [${issue.severity}] ${issue.section} — ${issue.problem}`)
    lines.push(`  → Action: ${issue.fix_suggestion}`)
  }
  if (critique.strengths.length > 0) {
    lines.push('')
    lines.push('STRENGTHS TO PRESERVE (do not regress these):')
    for (const s of critique.strengths) {
      lines.push(`• ${s}`)
    }
  }
  lines.push('')
  lines.push('Return the full revised page spec via the return_page_spec tool. The output must be a complete page, not a diff.')
  return lines.join('\n')
}

function severityRank(s: 'minor' | 'major' | 'critical'): number {
  return s === 'critical' ? 3 : s === 'major' ? 2 : 1
}

async function markFailed(buildId: string, error: string): Promise<void> {
  await db.landingPageBuild.update({
    where: { id: buildId },
    data: { status: 'failed', error: error.slice(0, 1000), completedAt: new Date() },
  }).catch(() => {})
}

async function markIterationFailed(iterationId: string, error: string): Promise<void> {
  await db.buildIteration.update({
    where: { id: iterationId },
    data: { status: 'failed', error: error.slice(0, 1000), completedAt: new Date() },
  }).catch(() => {})
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err).slice(0, 240)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

const BRAND_VOICES = ['friendly', 'authoritative', 'playful', 'luxury'] as const
type BrandVoice = (typeof BRAND_VOICES)[number]
function brandVoiceOr(v: string | null | undefined, fallback: BrandVoice): BrandVoice {
  return typeof v === 'string' && (BRAND_VOICES as readonly string[]).includes(v)
    ? (v as BrandVoice)
    : fallback
}
