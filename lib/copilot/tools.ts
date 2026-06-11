/**
 * Co-Pilot read-only tool catalog + server-side executor.
 *
 * Two tools in v0, both strictly read-only (NG1 — the co-pilot
 * guides, the user clicks):
 *
 *   - get_workspace_setup_state — live workspace state so the model
 *     never asserts configuration it hasn't checked (P0-6). Result
 *     includes workflow progress so the model can track step
 *     position without a second call.
 *   - query_knowledge — on-demand retrieval against the workspace's
 *     pgvector pool via the canonical retrieveChunks() entry point
 *     (P0-5's mid-session grounding; same proven pattern as the
 *     voice channel's query_knowledge).
 *
 * The tool DEFINITIONS are locked into the ephemeral token at mint
 * time; the EXECUTION happens here, server-side, via the
 * /api/copilot/sessions/[id]/tool endpoint — the browser only
 * ferries the call. The model declares them NON_BLOCKING so it can
 * keep talking while the round-trip resolves (P0-8 no-dead-air).
 */

import { retrieveChunks } from '@/lib/ingest/retrieve'
import { getWorkspaceSetupState, describeSetupState } from './setup-state'
import { getWorkflow, describeWorkflowProgress } from './workflows'
import type { RealtimeToolDef } from './types'

const QUERY_KNOWLEDGE_DEF: RealtimeToolDef = {
  name: 'query_knowledge',
  description:
    'Search the knowledge base for documented facts — product how-tos, policies, ' +
    'feature documentation. Call this before answering any question that needs ' +
    'specifics you have not verified. Returns ranked snippets.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question, restated naturally' },
    },
    required: ['query'],
  },
}

// annotate_screen is CLIENT-executed — the session panel draws the
// overlay and answers the model directly, no server round-trip. The
// definition lives here because tool defs are locked into the
// ephemeral token at mint time.
const ANNOTATE_SCREEN_DEF: RealtimeToolDef = {
  name: 'annotate_screen',
  description:
    'Draw a visual marker on the live screen preview to point at something — use it whenever ' +
    'you say things like "see that button" or "click here". Coordinates are PERCENTAGES of the ' +
    'shared screen as you last saw it (x: 0 = left edge, 100 = right edge; y: 0 = top, 100 = ' +
    'bottom). The user sees the marker on the live-help panel, so tell them to glance at it.',
  parameters: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'Horizontal center of the target, 0-100 (% of screen width)' },
      y: { type: 'number', description: 'Vertical center of the target, 0-100 (% of screen height)' },
      kind: { type: 'string', enum: ['circle', 'box'], description: 'circle = ring around a point; box = rectangle highlight' },
      width: { type: 'number', description: 'Box width as % of screen (box only, default 12)' },
      height: { type: 'number', description: 'Box height as % of screen (box only, default 6)' },
      label: { type: 'string', description: 'Short caption shown next to the marker (e.g. "Click here")' },
    },
    required: ['x', 'y', 'kind'],
  },
}

export const COPILOT_TOOL_DEFS: RealtimeToolDef[] = [
  {
    name: 'get_workspace_setup_state',
    description:
      'Read the live configuration state of this workspace: agents, active channels, ' +
      'knowledge, CRM connection, voice numbers, plus progress through the current ' +
      'setup workflow. Call this BEFORE asserting anything about what the user has ' +
      'or has not configured, and call it again after the user completes a step to ' +
      'confirm progress. Never guess at workspace state.',
    parameters: { type: 'object', properties: {} },
  },
  QUERY_KNOWLEDGE_DEF,
  ANNOTATE_SCREEN_DEF,
]

/**
 * Visitor-facing widget sessions get knowledge retrieval ONLY. The
 * setup-state tool reads internal workspace configuration (plans,
 * channel wiring, CRM status) — operator-facing data that must never
 * be exposed to an end customer through their own chat widget.
 */
export const WIDGET_TOOL_DEFS: RealtimeToolDef[] = [QUERY_KNOWLEDGE_DEF, ANNOTATE_SCREEN_DEF]

export interface CopilotToolContext {
  workspaceId: string
  workflowKey: string | null
  /** 'staff' (dashboard) | 'widget' (visitor-facing). Widget mode blocks internal-state tools. */
  mode: 'staff' | 'widget'
  /** Knowledge-domain scope for retrieval. Empty/undefined = workspace-wide. */
  knowledgeDomainIds?: string[]
}

/**
 * Execute one tool call. Returns a plain-text result the model can
 * speak from, never throws — tool failure must degrade to honest
 * "couldn't check" guidance, not dead air or fabrication (§8).
 */
export async function executeCopilotTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CopilotToolContext,
): Promise<string> {
  try {
    switch (name) {
      case 'get_workspace_setup_state': {
        // Internal workspace config — staff only. A widget session
        // requesting it (which shouldn't happen; it isn't declared
        // there) gets a refusal, not data.
        if (ctx.mode !== 'staff') {
          return 'That information is not available in this session.'
        }
        const state = await getWorkspaceSetupState(ctx.workspaceId)
        const workflow = getWorkflow(ctx.workflowKey)
        return `${describeSetupState(state)}\n\n${describeWorkflowProgress(workflow, state)}`
      }
      case 'query_knowledge': {
        const query = typeof args.query === 'string' ? args.query : ''
        const chunks = await retrieveChunks(ctx.workspaceId, query, {
          limit: 5,
          knowledgeDomainIds: ctx.knowledgeDomainIds,
        })
        if (chunks.length === 0) {
          return 'No documented answer found in the knowledge base. Say so honestly rather than improvising specifics.'
        }
        return chunks
          .map((c, i) => `[${i + 1}] ${c.content}`)
          .join('\n\n')
          .slice(0, 6000)
      }
      case 'annotate_screen':
        // Client-executed; reaching the server means an old client.
        return 'Annotation displayed.'
      default:
        return `Unknown tool "${name}".`
    }
  } catch (err) {
    console.error(`[Copilot tool] ${name} failed:`, err)
    return 'The tool call failed. Tell the user you could not check that right now and offer general guidance instead — do not invent specifics.'
  }
}
