/**
 * Workspace live-chat / queue settings access.
 *
 * One row per workspace (LiveChatSettings, mirrors TicketingSettings).
 * Returns sane defaults when no row exists or the table isn't migrated
 * yet, so callers never throw — queue-off is the safe default and is
 * exactly the wave-1 behaviour.
 */

import { db } from '@/lib/db'

export interface LiveChatSettings {
  queueEnabled: boolean
  maxConcurrentHumanChats: number
  queueGameEnabled: boolean
  queueEmailTicketEnabled: boolean
  queueMessage: string | null
  escalateAfterMinutes: number
  escalateReassign: boolean
}

export const LIVE_CHAT_DEFAULTS: LiveChatSettings = {
  queueEnabled: false,
  maxConcurrentHumanChats: 5,
  queueGameEnabled: false,
  queueEmailTicketEnabled: false,
  queueMessage: null,
  escalateAfterMinutes: 0,
  escalateReassign: false,
}

export async function getLiveChatSettings(workspaceId: string): Promise<LiveChatSettings> {
  try {
    const row = await (db as any).liveChatSettings.findUnique({ where: { workspaceId } })
    if (!row) return { ...LIVE_CHAT_DEFAULTS }
    return {
      queueEnabled: !!row.queueEnabled,
      maxConcurrentHumanChats:
        Number.isFinite(row.maxConcurrentHumanChats) && row.maxConcurrentHumanChats > 0
          ? row.maxConcurrentHumanChats
          : LIVE_CHAT_DEFAULTS.maxConcurrentHumanChats,
      queueGameEnabled: !!row.queueGameEnabled,
      queueEmailTicketEnabled: !!row.queueEmailTicketEnabled,
      queueMessage: row.queueMessage ?? null,
      escalateAfterMinutes:
        Number.isFinite(row.escalateAfterMinutes) && row.escalateAfterMinutes > 0
          ? row.escalateAfterMinutes
          : 0,
      escalateReassign: !!row.escalateReassign,
    }
  } catch {
    // Table missing (pre-migration) → behave as queue-off.
    return { ...LIVE_CHAT_DEFAULTS }
  }
}
