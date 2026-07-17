/**
 * /api/v1/demo-prospects — the outbound prospecting tool's surface.
 *
 * POST registers a prospect (cheap row; NO crawl/agent — provisioning
 * is lazy, on first landing-page visit). Idempotent per website domain.
 * GET returns engagement signals so the tool can prioritize follow-up.
 *
 * Auth: Bearer ApiKey (lib/api-auth). Accepted keys: org-scope, or a
 * workspace-scope key belonging to the internal demos workspace.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { authenticateApiKey, AuthError, type KeyContext } from '@/lib/api-auth'
import { errorResponse, ok, parseLimit } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { generateProspectSlug, normalizeWebsiteDomain } from '@/lib/demo-prospects/slug'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'

function requireDemoKey(key: KeyContext): void {
  const ws = demoWorkspaceId()
  if (!ws) throw new AuthError(503, 'not_configured', 'Demo provisioning is not configured')
  if (key.scope !== 'org' && key.workspaceId !== ws) {
    throw new AuthError(403, 'forbidden', 'Key is not authorized for demo provisioning')
  }
}

function publicBaseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/$/, '')
}

export const POST = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    requireDemoKey(key)

    const body = (await req.json().catch(() => ({}))) as {
      businessName?: string
      websiteUrl?: string
      contactEmail?: string
      vertical?: string
      templates?: { prompt?: string; instructions?: string; firstMessage?: string }
      metadata?: Record<string, unknown>
    }
    const businessName = (body.businessName || '').trim().slice(0, 120)
    const websiteUrl = (body.websiteUrl || '').trim()
    if (!businessName) throw new AuthError(422, 'bad_param', 'businessName required')
    if (
      JSON.stringify(body.templates ?? null).length > 20_000 ||
      JSON.stringify(body.metadata ?? null).length > 20_000
    ) {
      throw new AuthError(422, 'bad_param', 'templates/metadata too large')
    }

    let websiteDomain: string
    try {
      websiteDomain = normalizeWebsiteDomain(websiteUrl)
    } catch {
      throw new AuthError(422, 'bad_param', 'websiteUrl must be a valid URL or domain')
    }

    // Idempotent per domain: one live demo per business at a time.
    // `failed` is excluded so the tool can re-register after a failure.
    const existing = await db.demoProspect.findFirst({
      where: { websiteDomain, status: { notIn: ['expired', 'claimed', 'failed'] } },
      select: { slug: true },
    })
    if (existing) {
      return ok(
        { slug: existing.slug, url: `${publicBaseUrl()}/try/${existing.slug}`, existing: true },
        { apiKeyId: key.apiKeyId },
      )
    }

    const slug = generateProspectSlug(businessName)
    try {
      await db.demoProspect.create({
        data: {
          slug,
          businessName,
          websiteUrl: websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`,
          websiteDomain,
          contactEmail: body.contactEmail?.trim().slice(0, 320) || null,
          vertical: body.vertical?.trim().slice(0, 60) || null,
          templates:
            body.templates && typeof body.templates === 'object'
              ? (body.templates as Prisma.InputJsonValue)
              : undefined,
          metadata:
            body.metadata && typeof body.metadata === 'object'
              ? (body.metadata as Prisma.InputJsonValue)
              : undefined,
        },
      })
    } catch (err) {
      // Two concurrent registrations for the same domain both pass the
      // findFirst check above before either write lands; the partial
      // unique index on websiteDomain (manual_demo_prospects.sql) makes
      // the loser's create() throw P2002 instead of creating a second
      // live row. Re-run the lookup and adopt the winner's slug rather
      // than 500ing the race loser.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await db.demoProspect.findFirst({
          where: { websiteDomain, status: { notIn: ['expired', 'claimed', 'failed'] } },
          select: { slug: true },
        })
        if (winner) {
          return ok(
            { slug: winner.slug, url: `${publicBaseUrl()}/try/${winner.slug}`, existing: true },
            { apiKeyId: key.apiKeyId },
          )
        }
      }
      throw err
    }
    return ok({ slug, url: `${publicBaseUrl()}/try/${slug}`, existing: false }, { apiKeyId: key.apiKeyId })
  } catch (err) {
    return errorResponse(err)
  }
})

export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    requireDemoKey(key)

    const url = new URL(req.url)
    const since = url.searchParams.get('since')
    const sinceDate = since ? new Date(since) : null
    if (sinceDate && Number.isNaN(sinceDate.getTime())) {
      throw new AuthError(422, 'bad_param', 'since must be an ISO timestamp')
    }
    const status = url.searchParams.get('status')
    const rows = await db.demoProspect.findMany({
      where: {
        ...(sinceDate ? { updatedAt: { gte: sinceDate } } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: parseLimit(url, 100, 500),
      select: {
        slug: true, businessName: true, websiteDomain: true, vertical: true,
        status: true, clickedAt: true, firstCallAt: true, callCount: true,
        totalCallSecs: true, createdAt: true, updatedAt: true,
      },
    })
    return ok(rows, { apiKeyId: key.apiKeyId, count: rows.length })
  } catch (err) {
    return errorResponse(err)
  }
})
