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
import { generatePageImages, type HeroStyle } from './page-images'
import { runBrandScrapePipeline } from './brand-scrape-pipeline'
import type { BrandAnalysis } from './brand-vision'
import type { PageImages, PageSpec } from './page-spec'

interface RunBuildArgs {
  buildId: string
  /** Where the deployed app lives — used to construct the preview URL
   *  Browserbase navigates to. Defaults to the request origin in the
   *  caller; passed in explicitly because Vercel runtimes don't have a
   *  reliable "self" URL otherwise. */
  origin: string
  /** Hero strategy for THIS build. 'ai_photo' generates a Replicate
   *  Flux hero; 'gradient' skips it (renderer uses a brand-colour
   *  gradient). OG image generates either way when an image provider
   *  is configured. The wizard sets this from the brand step. */
  heroStyle: HeroStyle
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

  let ctx = await loadContext(build.campaignId, build.workspaceId)
  if (!ctx) {
    await markFailed(build.id, 'Campaign or brand context could not be loaded.')
    return
  }

  // ─── Brand scrape (idempotent, blocking) ───────────────────────────
  // The scrape ALSO fires from the funnel POST in `after()`, but that
  // races with the build kickoff — by the time the orchestrator reads
  // the campaign, the scrape almost certainly hasn't persisted yet,
  // and every iteration runs with an empty brand kit. Same fonts/style
  // every time = bug. So we run it again here, blocking before the
  // loop. The funnel POST writer racing in parallel is harmless: same
  // input → same output → idempotent overwrite.
  if (ctx.campaign.referenceUrl && !ctx.brandAnalysis) {
    console.log(`[build ${build.id}] running brand scrape for ${ctx.campaign.referenceUrl}`)
    try {
      const result = await runBrandScrapePipeline({
        url: ctx.campaign.referenceUrl,
        blobPathPrefix: `workspaces/${build.workspaceId}/campaigns/${build.campaignId}`,
      })
      if (result.ok) {
        await db.campaign.update({
          where: { id: build.campaignId },
          data: {
            brandScreenshotUrl: result.screenshotUrl,
            brandAnalysis: result.analysis as unknown as object,
            extractedColors: mergeColours(
              [result.analysis.primary_color, ...result.analysis.accent_colors],
              result.computedColors,
              ctx.brandKit.extracted_colors ?? [],
            ),
          },
        })
        // Refresh ctx so brandKit propagates to the LLM + image-gen.
        const refreshed = await loadContext(build.campaignId, build.workspaceId)
        if (refreshed) ctx = refreshed
        console.log(`[build ${build.id}] brand scrape ok — vibe="${result.analysis.design_vibe}", voice=${result.analysis.voice_tone}, photo=${result.analysis.photography_style}`)
      } else {
        console.warn(`[build ${build.id}] brand scrape skipped: ${result.reason}${result.error ? ` (${result.error})` : ''}`)
      }
    } catch (err) {
      console.warn(`[build ${build.id}] brand scrape crashed:`, errMsg(err))
    }
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
  // Hero + OG carry across iterations as a fallback. Generated fresh
  // on iteration 1 and again on any iteration where the critic flagged
  // hero imagery as critical/major — the previous design ("gen once,
  // reuse") meant the hero never got fixed even when the critic said
  // it was the #1 blocker.
  let images: PageImages | null = null

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

      // Image gen: fire on iteration 1 always, and again on any
      // iteration where the previous critique flagged the hero as
      // critical/major. Otherwise reuse the previous iteration's
      // images — a fresh Replicate call costs ~$0.06 and ~30s.
      const heroFlagged = previousCritique?.issues.some((i) =>
        i.section === 'hero' && (i.severity === 'critical' || i.severity === 'major') &&
        /image|photo|hero|stock|generic/i.test(`${i.problem} ${i.fix_suggestion}`),
      ) ?? false
      const shouldGenImages = iter === 1 || heroFlagged
      // Track which provider actually fired. Stashed on every
      // iteration's spec.images so we can verify Replicate vs Gemini
      // from the DB without needing the imageGenReport column.
      let imageGenProviderForLog: string | null = null
      if (shouldGenImages) {
        let report: Record<string, unknown> | null = null
        try {
          const out = await generatePageImages({
            intake: ctx.intake,
            spec: currentSpec,
            brandKit: ctx.brandKit,
            heroStyle: args.heroStyle,
            keyPrefix: `landing/builds/${build.id}`,
          })
          if (out.images.hero_url || out.images.og_url) {
            images = out.images
          }
          imageGenProviderForLog = out.provider ?? null
          report = {
            enabled: out.enabled,
            attempted: out.attempted,
            succeeded: out.succeeded,
            provider: out.provider ?? null,
            errors: out.errors,
            heroStyle: args.heroStyle,
            heroUrl: out.images.hero_url ?? null,
            ogUrl: out.images.og_url ?? null,
          }
          // Always log the outcome so it's grep-able in Vercel runtime
          // logs — `provider=replicate succeeded=2/2` is unambiguous.
          console.log(
            `[build ${build.id}] image-gen iter=${iter} ` +
            `provider=${out.provider ?? 'none'} ` +
            `attempted=${out.attempted} succeeded=${out.succeeded} ` +
            `enabled=${out.enabled} ` +
            (out.errors.length > 0 ? `errors=${JSON.stringify(out.errors)}` : 'errors=none'),
          )
        } catch (err) {
          report = {
            enabled: true,
            attempted: 0,
            succeeded: 0,
            provider: null,
            errors: [`unhandled: ${errMsg(err)}`],
            heroStyle: args.heroStyle,
            heroUrl: null,
            ogUrl: null,
          }
          console.warn(`[build ${build.id}] image gen crashed:`, errMsg(err))
        }
        if (report) {
          await db.landingPageBuild.update({
            where: { id: build.id },
            data: { imageGenReport: report as unknown as object },
          }).catch(() => {})
        }
      }
      // Merge generated images into the spec the renderer reads. The
      // hero + OG live on spec.images; bake them in BEFORE saving so
      // every iteration's published draft includes them.
      // _provider is a diagnostic stash — the renderer ignores
      // unknown fields, but we can grep the DB to verify Replicate
      // is firing rather than Gemini fallback.
      if (images || imageGenProviderForLog) {
        currentSpec.images = {
          ...(currentSpec.images ?? {}),
          ...(images ?? {}),
          ...(imageGenProviderForLog ? { _provider: imageGenProviderForLog } : {}),
        } as typeof currentSpec.images
      }

      // When the operator picked AI photo and image-gen succeeded,
      // make sure the hero LAYOUT actually uses the image. Claude
      // routinely emits `form-in-hero` or `gradient` even when an
      // image is available — both layouts ignore the hero photo
      // entirely, so we burn $0.06 on Replicate output that never
      // renders. Override to `image-bg` (full-bleed photo with
      // overlay copy) which is the most striking use of the image.
      if (args.heroStyle === 'ai_photo' && currentSpec.images?.hero_url) {
        const heroIdx = currentSpec.sections.findIndex((s) => s.type === 'hero')
        if (heroIdx >= 0) {
          const hero = currentSpec.sections[heroIdx]
          if (hero.type === 'hero') {
            const layout = hero.layout
            if (!layout || layout === 'form-in-hero' || layout === 'gradient') {
              currentSpec.sections[heroIdx] = { ...hero, layout: 'image-bg' }
              console.log(`[build ${build.id}] iter=${iter} forced hero layout image-bg (was ${layout ?? 'unset'})`)
            }
          }
        }
      }

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
    referenceUrl: string | null
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
      referenceUrl: c.referenceUrl,
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
 *
 * Also pushes the model to make SUBSTANTIVE changes. The default
 * behaviour with revision feedback is regression-to-the-mean: small
 * word-level edits, the same overall structure, the same critic-flagged
 * problems persisting iteration after iteration. We want the model to
 * feel licensed to throw out whole sections, restructure copy, and
 * rewrite headlines — that's what an actual designer would do between
 * drafts.
 */
function buildRevisionBrief(critique: PageCritique, nextIteration: number): string {
  const issuesByPriority = [...critique.issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  const criticalCount = issuesByPriority.filter((i) => i.severity === 'critical').length
  const majorCount = issuesByPriority.filter((i) => i.severity === 'major').length

  const lines: string[] = []
  lines.push(`═══ REVISION BRIEF — Iteration ${nextIteration} ═══`)
  lines.push('')
  lines.push(`The previous iteration scored **${critique.score.toFixed(1)}/10** from a senior conversion designer.`)
  lines.push(`This page does NOT ship until it clears 8.0. ${criticalCount} critical and ${majorCount} major issue${majorCount === 1 ? '' : 's'} remain.`)
  lines.push('')
  lines.push('## How to revise')
  lines.push('')
  lines.push('Make SUBSTANTIVE changes. Word-level tweaks are not enough. If a section is flagged, REWRITE it — change the headline, restructure the copy, swap the framing. Do not return a near-copy of the previous spec with minor edits — that produces "same problems, slightly different wording" and the critic will flag the same issues again.')
  lines.push('')
  lines.push('Specifically:')
  lines.push('- If the hero is flagged: completely rewrite the headline AND subheadline. Try a different angle (benefit-first, mechanism-first, problem-first) than last time.')
  lines.push('- If proof is flagged: invent more specific testimonials with names, roles, locations, exact metrics. Remove generic ones.')
  lines.push('- If the offer is flagged: spell out exact deliverables as a list. State the price or path-to-price unambiguously.')
  lines.push('- If layout/density is flagged: cut sections you don\'t need. Better a 7-section page that breathes than 12 sections cramped together.')
  lines.push('')
  lines.push("Do NOT preserve the previous spec's structure for its own sake. The previous spec scored badly. Your job is to fix it, not echo it.")
  lines.push('')
  lines.push("## Designer's summary of what's wrong")
  lines.push('')
  lines.push(critique.summary)
  lines.push('')
  lines.push(`## Fixes to apply (${issuesByPriority.length} total, in priority order)`)
  lines.push('')
  for (const issue of issuesByPriority) {
    lines.push(`**[${issue.severity.toUpperCase()}] ${issue.section}**`)
    lines.push(`  Problem: ${issue.problem}`)
    lines.push(`  Apply: ${issue.fix_suggestion}`)
    lines.push('')
  }
  if (critique.strengths.length > 0) {
    lines.push('## Strengths to preserve')
    lines.push('(Don\'t regress these. Everything else is up for redesign.)')
    lines.push('')
    for (const s of critique.strengths) {
      lines.push(`- ${s}`)
    }
    lines.push('')
  }
  lines.push('## Output')
  lines.push('Return the full revised page spec via the `return_page_spec` tool. Output must be a complete page, not a diff. Treat this as a fresh draft informed by the critique — not an edit of the previous draft.')
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

function mergeColours(...lists: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const c of list) {
      if (typeof c !== 'string') continue
      const v = c.trim()
      if (!/^#?[0-9a-fA-F]{6}$/.test(v)) continue
      const hex = v.startsWith('#') ? v.toLowerCase() : `#${v.toLowerCase()}`
      if (seen.has(hex)) continue
      seen.add(hex)
      out.push(hex)
      if (out.length >= 8) return out
    }
  }
  return out
}

const BRAND_VOICES = ['friendly', 'authoritative', 'playful', 'luxury'] as const
type BrandVoice = (typeof BRAND_VOICES)[number]
function brandVoiceOr(v: string | null | undefined, fallback: BrandVoice): BrandVoice {
  return typeof v === 'string' && (BRAND_VOICES as readonly string[]).includes(v)
    ? (v as BrandVoice)
    : fallback
}
