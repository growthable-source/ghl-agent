/**
 * Voice-assistant resync — invalidate registered Vapi assistants when
 * workspace-level capabilities change.
 *
 * Root cause this exists for: assistant configs bake in point-in-time
 * state (Shopify tools + commerce prompt are included only when
 * getShopifyConnection() succeeds AT REGISTRATION). A workspace that
 * connects Shopify AFTER its voice agents registered keeps assistants
 * with no commerce tools — the model then truthfully tells callers it
 * "can't access live stock data" while the dashboard shows a healthy
 * connection. Diagnosing that cost three debugging rounds because no
 * tool call ever fired, so no tool-side logging could see it.
 *
 * The fix reuses the established lazy-backfill machinery: clearing
 * VapiConfig.vapiAssistantId makes the next save/call re-register the
 * assistant with freshly-evaluated capabilities (ensureVapiAssistant
 * handles creation). We clear rather than eagerly PATCH because the
 * connect/disconnect routes shouldn't block on N Vapi API calls.
 *
 * Call this from ANY route that changes what a voice agent can do at
 * the workspace level: connector OAuth callbacks, disconnects,
 * uninstall webhooks.
 */

import { db } from '@/lib/db'

export async function resyncWorkspaceVoiceAssistants(workspaceId: string, reason: string): Promise<number> {
  try {
    const result = await db.vapiConfig.updateMany({
      where: { agent: { workspaceId }, vapiAssistantId: { not: null } },
      data: { vapiAssistantId: null },
    })
    if (result.count > 0) {
      console.log(`[voice resync] cleared ${result.count} assistant id(s) for workspace ${workspaceId} (${reason}) — re-register on next call/save`)
    }
    return result.count
  } catch (err) {
    console.error(`[voice resync] failed for workspace ${workspaceId} (${reason}):`, err)
    return 0
  }
}
