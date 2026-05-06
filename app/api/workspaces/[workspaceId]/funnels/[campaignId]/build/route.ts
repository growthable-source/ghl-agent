/**
 * POST /api/workspaces/<wsId>/funnels/<campaignId>/build
 *
 * Kicks off a Manus-style build loop for the campaign. Returns 202
 * with the buildId IMMEDIATELY — the orchestrator runs in `after()`
 * so the response isn't blocked by the 6-12 minute loop. The wizard
 * UI then polls the GET sibling endpoint every ~2s to refresh the
 * timeline as iteration rows are written.
 *
 * Vercel `after()` keeps the function alive past the response for up
 * to maxDuration (800s on Pro). If the loop hits the cap, whatever
 * iterations completed by then are still persisted; the build row
 * gets marked failed with a timeout reason.
 *
 *
 * GET /api/workspaces/<wsId>/funnels/<campaignId>/build
 *
 * Returns the latest build for this campaign with its iterations
 * inlined. The wizard polls this every ~2s during a build to refresh
 * the timeline.
 */

import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { runBuild } from '@/lib/build-orchestrator'

// Build runs render + vision + regen for up to 5 iterations. Worst-case
// budget: ~5 * (45s render + 25s critique + 60s regen) = ~11 min.
// Vercel Pro caps at 800s — that's enough margin.
export const maxDuration = 800
export const dynamic = 'force-dynamic'

const DEFAULT_MAX_ITERATIONS = 5
const DEFAULT_SCORE_THRESHOLD = 8.0

interface BuildBody {
  /** Override the default 5-iteration cap. Capped server-side at 8. */
  max_iterations?: number
  /** Override the default 8.0 score threshold. Range: 5-10. */
  score_threshold?: number
  /** Hero strategy. 'ai_photo' (default) burns ~$0.06 on Replicate
   *  Flux for a hero photo. 'gradient' skips it; renderer uses a
   *  brand-colour gradient hero. */
  hero_style?: 'ai_photo' | 'gradient'
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; campaignId: string }> },
) {
  const { workspaceId, campaignId } = await params

  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, workspaceId: true },
  })
  if (!campaign || campaign.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  let body: BuildBody = {}
  try { body = (await req.json()) as BuildBody } catch { /* allow empty */ }

  const maxIterations = clampInt(body.max_iterations, 1, 8, DEFAULT_MAX_ITERATIONS)
  const scoreThreshold = clampNum(body.score_threshold, 5, 10, DEFAULT_SCORE_THRESHOLD)
  const heroStyle: 'ai_photo' | 'gradient' = body.hero_style === 'gradient' ? 'gradient' : 'ai_photo'

  // Refuse if a build is already running for this campaign — concurrent
  // builds would race on the LandingPage spec.
  const inFlight = await db.landingPageBuild.findFirst({
    where: { campaignId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  if (inFlight) {
    return NextResponse.json(
      { error: 'A build is already in progress for this campaign.', buildId: inFlight.id },
      { status: 409 },
    )
  }

  const build = await db.landingPageBuild.create({
    data: { workspaceId, campaignId, maxIterations, scoreThreshold, status: 'queued' },
    select: { id: true },
  })

  // Determine the origin for the preview URL. NEXT_PUBLIC_BASE_URL is
  // set on Vercel; fall back to the request's host header for local dev.
  // Browserbase needs a publicly resolvable URL — localhost won't work.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, '') ??
    `${req.nextUrl.protocol}//${req.headers.get('host') ?? req.nextUrl.host}`

  // Run the loop in `after()` so the 202 response goes back to the
  // wizard immediately. The orchestrator catches its own errors and
  // writes them to the build row, so an unhandled rejection here
  // would only happen on a defect — log it and let it surface.
  after(async () => {
    try {
      await runBuild({ buildId: build.id, origin: baseUrl, heroStyle })
    } catch (err) {
      console.error(`[build ${build.id}] orchestrator crashed:`, err)
      await db.landingPageBuild.update({
        where: { id: build.id },
        data: {
          status: 'failed',
          error: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
          completedAt: new Date(),
        },
      }).catch(() => {})
    }
  })

  return NextResponse.json(
    { build: { id: build.id, status: 'queued', maxIterations, scoreThreshold } },
    { status: 202 },
  )
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; campaignId: string }> },
) {
  const { workspaceId, campaignId } = await params

  const auth = await requireWorkspaceRole(workspaceId, 'member')
  if (auth instanceof NextResponse) return auth

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, workspaceId: true },
  })
  if (!campaign || campaign.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const build = await db.landingPageBuild.findFirst({
    where: { campaignId },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true, status: true, maxIterations: true, scoreThreshold: true,
      bestScore: true, bestIterationId: true, error: true,
      imageGenReport: true,
      startedAt: true, completedAt: true,
      iterations: {
        orderBy: { iteration: 'asc' },
        select: {
          id: true, iteration: true, status: true,
          screenshotUrl: true, score: true, critique: true, error: true,
          // specSnapshot included so the wizard can publish any iteration
          // without a follow-up fetch. ~30KB per iteration is fine on
          // the 2s polling interval.
          specSnapshot: true,
          startedAt: true, completedAt: true,
        },
      },
    },
  })
  if (!build) return NextResponse.json({ build: null })
  return NextResponse.json({ build })
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, Math.round(v)))
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, v))
}
