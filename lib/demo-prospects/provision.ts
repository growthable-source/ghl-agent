/**
 * Lazy provisioning for prospect voice demos. Called from the public
 * status endpoint on the first /try/[slug] visit — NOT at registration
 * time, so the ~97% of cold-emailed prospects who never click cost one
 * DB row and nothing else.
 *
 * Idempotent + re-entrant: each asset creation is guarded by its
 * nullable FK on the DemoProspect row, and the registered→provisioning
 * transition is a compare-and-swap so concurrent pollers don't
 * double-provision. A crash mid-way is healed by the next poll (the
 * remaining null fields get filled in).
 *
 * The crawl itself is asynchronous — the every-minute ingest-queue cron
 * picks up the queued IngestionRun. Readiness is agent-existence, not
 * crawl-completion: greeting + business name carry the demo even with
 * zero chunks landed.
 */
import { db } from '@/lib/db'
import { detectUrl } from '@/lib/ingest/detect'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'
import { buildTemplateVars, resolveTemplates, type DemoTemplateSet } from './templates'

const TTL_DAYS = Number(process.env.DEMO_PROSPECT_TTL_DAYS) || 14
const DEMO_TRY_MAX_SECS = Number(process.env.DEMO_TRY_MAX_SECS) || 180

export function demoWorkspaceId(): string | null {
  return process.env.DEMO_WORKSPACE_ID || null
}

type Prospect = NonNullable<Awaited<ReturnType<typeof db.demoProspect.findUnique>>>

/**
 * Ensure the prospect's demo assets exist. Returns the (possibly
 * updated) prospect row, or null if the slug doesn't exist / the
 * feature isn't configured.
 */
export async function ensureProvisioned(slug: string): Promise<Prospect | null> {
  const workspaceId = demoWorkspaceId()
  if (!workspaceId) return null

  let prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return null

  // Terminal / already-done states: nothing to do.
  if (!['registered', 'provisioning'].includes(prospect.status)) return prospect

  // CAS: registered → provisioning (stamps the click). Losing the race
  // is fine — fall through and run the idempotent steps anyway; each is
  // guarded by its own null-field check.
  if (prospect.status === 'registered') {
    await db.demoProspect.updateMany({
      where: { id: prospect.id, status: 'registered' },
      data: { status: 'provisioning', clickedAt: prospect.clickedAt ?? new Date() },
    })
    prospect = (await db.demoProspect.findUnique({ where: { slug } }))!
  }

  try {
    // 1. Knowledge domain (per-prospect isolation for retrieval scoping)
    let knowledgeDomainId = prospect.knowledgeDomainId
    if (!knowledgeDomainId) {
      const domain = await db.knowledgeDomain.create({
        data: {
          workspaceId,
          name: `Demo: ${prospect.businessName} (${prospect.slug})`,
          description: `Auto-crawled from ${prospect.websiteUrl} for the prospect voice demo.`,
        },
        select: { id: true },
      })
      knowledgeDomainId = domain.id
      await db.demoProspect.update({ where: { id: prospect.id }, data: { knowledgeDomainId } })
    }

    // 2. Crawl source + queued run (the ingest-queue cron does the work)
    let ingestionRunId = prospect.ingestionRunId
    if (!ingestionRunId) {
      const detection = await detectUrl(prospect.websiteUrl)
      const source = await db.knowledgeSource.create({
        data: {
          knowledgeDomainId,
          sourceType: detection.sourceType,
          urlOrIdentifier: prospect.websiteUrl,
          crawlConfig: detection.crawlConfig as object,
          isActive: true,
        },
        select: { id: true },
      })
      const run = await db.ingestionRun.create({
        data: { sourceId: source.id, status: 'queued' },
        select: { id: true },
      })
      ingestionRunId = run.id
      await db.demoProspect.update({ where: { id: prospect.id }, data: { ingestionRunId } })
    }

    // 3. Agent + voice config from resolved templates
    if (!prospect.agentId) {
      const vars = buildTemplateVars(
        {
          businessName: prospect.businessName,
          websiteDomain: prospect.websiteDomain,
          vertical: prospect.vertical,
        },
        (prospect.metadata ?? null) as Record<string, unknown> | null,
      )
      const templates = resolveTemplates({
        vertical: prospect.vertical,
        overrides: (prospect.templates ?? null) as Partial<DemoTemplateSet> | null,
        vars,
      })

      const location = await ensureDemoLocation(workspaceId)
      const agent = await db.agent.create({
        data: {
          workspaceId,
          locationId: location.id,
          name: `Demo — ${prospect.businessName}`,
          systemPrompt: templates.prompt,
          instructions: templates.instructions,
          enabledTools: [],
          agentType: 'SIMPLE',
          agentKind: 'reactive',
          voiceRuntime: 'gemini',
          knowledgeScopeAll: false,
          knowledgeDomainIds: [knowledgeDomainId],
        },
        select: { id: true },
      })

      // CAS the agentId on — if another racer beat us, roll back ours.
      const won = await db.demoProspect.updateMany({
        where: { id: prospect.id, agentId: null },
        data: { agentId: agent.id },
      })
      if (won.count === 0) {
        await db.agent.delete({ where: { id: agent.id } }).catch(() => {})
      } else {
        await db.geminiVoiceConfig.create({
          data: {
            agentId: agent.id,
            isActive: true,
            model: geminiVoiceModel(),
            firstMessage: templates.firstMessage,
            maxDurationSecs: DEMO_TRY_MAX_SECS,
            recordCalls: false,
          },
        })
      }
    }

    // 4. Finalize: ready + TTL clock starts now
    await db.demoProspect.updateMany({
      where: { id: prospect.id, status: 'provisioning' },
      data: {
        status: 'ready',
        expiresAt: new Date(Date.now() + TTL_DAYS * 86400_000),
      },
    })
    return db.demoProspect.findUnique({ where: { slug } })
  } catch (err) {
    console.error(`[demo-prospects] provisioning failed for ${slug}:`, err)
    // Only the agent is load-bearing — if it exists, stay provisioning
    // so the next poll retries the rest; otherwise mark failed.
    const fresh = await db.demoProspect.findUnique({ where: { slug } })
    if (fresh && !fresh.agentId) {
      await db.demoProspect.updateMany({
        where: { id: prospect.id, status: 'provisioning' },
        data: { status: 'failed' },
      })
    }
    return db.demoProspect.findUnique({ where: { slug } })
  }
}

/**
 * Agent.locationId is a required FK — mirror the wizard's placeholder
 * pattern inside the demos workspace.
 */
async function ensureDemoLocation(workspaceId: string): Promise<{ id: string }> {
  const existing = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
    orderBy: { installedAt: 'desc' },
  })
  if (existing) return existing
  const placeholderId = `placeholder:${workspaceId}`
  return db.location.upsert({
    where: { id: placeholderId },
    create: {
      id: placeholderId,
      workspaceId,
      companyId: '', userId: '', userType: '', scope: '',
      accessToken: '', refreshToken: '', refreshTokenId: '',
      expiresAt: new Date(0),
      crmProvider: 'none',
    },
    update: {},
    select: { id: true },
  })
}
