import { db } from './db'

/**
 * Platform-learnings apply / retire / runtime-injection helpers.
 *
 * Three scopes, three application strategies:
 *
 *   this_agent  — mutates the target agent's systemPrompt. The learning's
 *                 content is fenced with HTML-comment markers keyed by
 *                 the learning id so Retire is a safe string-replace.
 *   workspace   — nothing is mutated. At runtime, buildSystemPrompt
 *                 pulls every applied workspace-scoped learning for the
 *                 current agent's workspace and appends a
 *                 "## Platform Guidelines" block.
 *   all_agents  — same runtime injection as workspace, but for every
 *                 workspace that hasn't opted out via
 *                 Workspace.disableGlobalLearnings.
 *
 * The runtime injection is cached per workspace for 2 minutes so the
 * agent hot-path doesn't hit the DB on every inbound. Apply/retire call
 * invalidateGuidelinesCache() to keep the window of staleness small.
 */

// ─── Marker helpers (scope=this_agent only) ─────────────────────────────────

export function beginMarker(learningId: string): string {
  return `<!-- learning:${learningId} -->`
}

export function endMarker(learningId: string): string {
  return `<!-- /learning:${learningId} -->`
}

export function appendLearningToPrompt(
  currentPrompt: string,
  learningId: string,
  content: string,
): string {
  const start = beginMarker(learningId)
  const end = endMarker(learningId)
  if (currentPrompt.includes(start)) {
    return currentPrompt
  }
  const block = `\n\n${start}\n${content.trim()}\n${end}`
  return currentPrompt + block
}

export function removeLearningFromPrompt(
  currentPrompt: string,
  learningId: string,
): string {
  const start = beginMarker(learningId)
  const end = endMarker(learningId)
  const startIdx = currentPrompt.indexOf(start)
  if (startIdx === -1) return currentPrompt
  const endIdx = currentPrompt.indexOf(end, startIdx)
  if (endIdx === -1) return currentPrompt
  const stripEnd = endIdx + end.length
  const trailing = currentPrompt.charAt(stripEnd) === '\n' ? 1 : 0
  const leading = currentPrompt.charAt(startIdx - 1) === '\n'
    && currentPrompt.charAt(startIdx - 2) === '\n'
    ? 1
    : 0
  return currentPrompt.slice(0, startIdx - leading) + currentPrompt.slice(stripEnd + trailing)
}

// ─── In-memory cache for the runtime injection ──────────────────────────────

interface CachedBlock {
  block: string
  expiresAt: number
}
const guidelinesCache = new Map<string, CachedBlock>()
const CACHE_TTL_MS = 2 * 60 * 1000  // 2 minutes; tune if prompt drift becomes noticeable
const MAX_GUIDELINES_CHARS = 6000   // hard cap on the block we inject

function cacheKey(workspaceId: string | null): string {
  // null-workspace agents still hit the all_agents learnings. Separate
  // bucket so we don't confuse them with a specific workspace.
  return workspaceId ?? '__null_workspace__'
}

/**
 * Drop cache entries for workspaces whose platform guidelines may have
 * changed. Called after every apply/retire.
 *
 * For a scope=all_agents learning we nuke the entire cache because it
 * affects every workspace. For scope=workspace or this_agent we only
 * nuke that workspace's entry (this_agent doesn't go through this
 * block at all, but invalidating is cheap and keeps the code simple).
 */
export function invalidateGuidelinesCache(
  scope: string,
  workspaceId: string | null,
): void {
  if (scope === 'all_agents') {
    guidelinesCache.clear()
    return
  }
  if (workspaceId) {
    guidelinesCache.delete(cacheKey(workspaceId))
  }
  // Always drop the null-workspace bucket too, since scope=all_agents
  // writes land there. Cheaper than being clever.
  guidelinesCache.delete('__null_workspace__')
}

/**
 * Build the "## Platform Guidelines" block that gets injected into
 * buildSystemPrompt at runtime. Returns empty string when:
 *   - the workspace has opted out (disableGlobalLearnings=true)
 *   - there are no applied workspace/all_agents learnings
 *
 * Not used for scope=this_agent learnings — those are baked into the
 * agent's systemPrompt directly.
 */
export async function loadPlatformGuidelinesBlock(
  workspaceId: string | null,
): Promise<string> {
  const key = cacheKey(workspaceId)
  const cached = guidelinesCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.block

  // Respect the per-workspace opt-out. A workspace that disabled global
  // learnings still sees NOTHING — including its own workspace-scoped
  // learnings, on the theory that disabling is "keep my prompts
  // pristine" and partial injection would be surprising. Easy to change
  // later if a customer actually asks.
  if (workspaceId) {
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { disableGlobalLearnings: true },
    })
    if (ws?.disableGlobalLearnings) {
      guidelinesCache.set(key, { block: '', expiresAt: Date.now() + CACHE_TTL_MS })
      return ''
    }
  }

  const learnings = await db.platformLearning.findMany({
    where: {
      status: 'applied',
      type: 'prompt_addition',   // only prompt_addition is injected in PR 2
      OR: [
        { scope: 'all_agents' },
        ...(workspaceId ? [{ scope: 'workspace', workspaceId }] : []),
      ],
    },
    // Order deterministic: newest last, so the most recent guidance
    // gets the "last word" with the LLM. Easier to reason about than
    // priority-based ordering.
    orderBy: { appliedAt: 'asc' },
    select: { id: true, content: true, title: true },
  })

  if (learnings.length === 0) {
    guidelinesCache.set(key, { block: '', expiresAt: Date.now() + CACHE_TTL_MS })
    return ''
  }

  // Char budget: keep adding until we'd overflow, then stop. Drop the
  // oldest if we needed to (which matches "newest last" — the oldest
  // are at the front, newest at the end, so we pop from the front). In
  // practice this only kicks in once someone's accumulated a lot of
  // global learnings; the day-one reality is well under 6k.
  const budget = MAX_GUIDELINES_CHARS
  const entries: string[] = []
  let total = 0
  // Walk right-to-left so newest are kept first.
  for (let i = learnings.length - 1; i >= 0; i--) {
    const l = learnings[i]
    const piece = `- ${l.content.trim()}`
    if (total + piece.length + 1 > budget) break
    entries.unshift(piece)
    total += piece.length + 1
  }

  const block = entries.length > 0
    ? `\n\n## Platform Guidelines\n${entries.join('\n')}`
    : ''

  guidelinesCache.set(key, { block, expiresAt: Date.now() + CACHE_TTL_MS })
  return block
}

// ─── Apply / Retire ─────────────────────────────────────────────────────────

export async function applyLearning(learningId: string): Promise<
  | { ok: true; agentId: string | null; scope: string }
  | { ok: false; error: string }
> {
  const learning = await db.platformLearning.findUnique({
    where: { id: learningId },
    select: {
      id: true, status: true, type: true, content: true,
      agentId: true, workspaceId: true, scope: true,
    },
  })
  if (!learning) return { ok: false, error: 'Learning not found' }
  if (learning.status === 'applied') return { ok: false, error: 'Already applied' }
  if (learning.status !== 'approved') return { ok: false, error: 'Must be approved before applying' }
  if (learning.type !== 'prompt_addition') {
    return { ok: false, error: `Unsupported learning type: ${learning.type}` }
  }

  const now = new Date()

  // scope=this_agent: actually mutate the agent's systemPrompt.
  if (learning.scope === 'this_agent') {
    if (!learning.agentId) {
      return { ok: false, error: 'this_agent scope but no agentId' }
    }
    const agent = await db.agent.findUnique({
      where: { id: learning.agentId },
      select: { id: true, systemPrompt: true },
    })
    if (!agent) return { ok: false, error: 'Target agent no longer exists' }

    const nextPrompt = appendLearningToPrompt(
      agent.systemPrompt ?? '',
      learning.id,
      learning.content,
    )

    await db.$transaction([
      db.agent.update({ where: { id: agent.id }, data: { systemPrompt: nextPrompt } }),
      db.platformLearning.update({
        where: { id: learning.id },
        data: { status: 'applied', appliedAt: now, appliedTarget: 'agent.systemPrompt' },
      }),
    ])
    invalidateGuidelinesCache(learning.scope, learning.workspaceId)
    return { ok: true, agentId: agent.id, scope: learning.scope }
  }

  // scope=workspace OR all_agents: no prompt mutation, just flip status.
  // buildSystemPrompt picks up applied rows via loadPlatformGuidelinesBlock.
  if (learning.scope === 'workspace' || learning.scope === 'all_agents') {
    await db.platformLearning.update({
      where: { id: learning.id },
      data: { status: 'applied', appliedAt: now, appliedTarget: 'runtime:platform_guidelines' },
    })
    invalidateGuidelinesCache(learning.scope, learning.workspaceId)
    return { ok: true, agentId: null, scope: learning.scope }
  }

  return { ok: false, error: `Unknown scope: ${learning.scope}` }
}

export async function retireLearning(learningId: string): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const learning = await db.platformLearning.findUnique({
    where: { id: learningId },
    select: {
      id: true, status: true, agentId: true, workspaceId: true, scope: true,
    },
  })
  if (!learning) return { ok: false, error: 'Learning not found' }
  if (learning.status !== 'applied') {
    return { ok: false, error: 'Only applied learnings can be retired' }
  }

  if (learning.scope === 'this_agent') {
    if (learning.agentId) {
      const agent = await db.agent.findUnique({
        where: { id: learning.agentId },
        select: { id: true, systemPrompt: true },
      })
      if (agent) {
        const nextPrompt = removeLearningFromPrompt(agent.systemPrompt ?? '', learning.id)
        await db.$transaction([
          db.agent.update({ where: { id: agent.id }, data: { systemPrompt: nextPrompt } }),
          db.platformLearning.update({
            where: { id: learning.id },
            data: { status: 'retired' },
          }),
        ])
        invalidateGuidelinesCache(learning.scope, learning.workspaceId)
        return { ok: true }
      }
    }
    // Agent gone / no agentId — just flip status.
    await db.platformLearning.update({
      where: { id: learning.id },
      data: { status: 'retired' },
    })
    invalidateGuidelinesCache(learning.scope, learning.workspaceId)
    return { ok: true }
  }

  // Global/workspace retire: flip status, bust cache, done.
  await db.platformLearning.update({
    where: { id: learning.id },
    data: { status: 'retired' },
  })
  invalidateGuidelinesCache(learning.scope, learning.workspaceId)
  return { ok: true }
}
