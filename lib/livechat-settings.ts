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
  autoAwayEnabled: boolean
  autoAwayMinutes: number
}

// Auto-away bounds: below 5 minutes a slow reader gets flipped mid-chat;
// the cron only runs every few minutes anyway so tighter adds nothing.
export const AUTO_AWAY_MIN_MINUTES = 5
export const AUTO_AWAY_MAX_MINUTES = 1440

export const LIVE_CHAT_DEFAULTS: LiveChatSettings = {
  queueEnabled: false,
  maxConcurrentHumanChats: 5,
  queueGameEnabled: false,
  queueEmailTicketEnabled: false,
  queueMessage: null,
  escalateAfterMinutes: 0,
  escalateReassign: false,
  // On by default — the whole point is not relying on humans to toggle.
  // Harmless pre-heartbeat: the cron only sweeps members it has seen.
  autoAwayEnabled: true,
  autoAwayMinutes: 15,
}

export async function getLiveChatSettings(workspaceId: string): Promise<LiveChatSettings> {
  try {
    let row: any = null
    try {
      row = await (db as any).liveChatSettings.findUnique({ where: { workspaceId } })
    } catch (err: any) {
      // Schema knows columns the DB doesn't have yet (deploy landed,
      // hand-run SQL pending). Refetch with the legacy column list so a
      // workspace's queue settings survive the gap instead of silently
      // degrading to defaults; the missing fields map to their defaults
      // below. Anything else rethrows to the outer catch.
      if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) throw err
      row = await (db as any).liveChatSettings.findUnique({
        where: { workspaceId },
        select: {
          queueEnabled: true, maxConcurrentHumanChats: true,
          queueGameEnabled: true, queueEmailTicketEnabled: true,
          queueMessage: true, escalateAfterMinutes: true, escalateReassign: true,
        },
      })
    }
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
      // Columns may predate the auto-away migration — undefined reads as
      // the defaults (enabled / 15 min).
      autoAwayEnabled: row.autoAwayEnabled === undefined ? LIVE_CHAT_DEFAULTS.autoAwayEnabled : !!row.autoAwayEnabled,
      autoAwayMinutes:
        Number.isFinite(row.autoAwayMinutes) && row.autoAwayMinutes >= AUTO_AWAY_MIN_MINUTES
          ? Math.min(AUTO_AWAY_MAX_MINUTES, row.autoAwayMinutes)
          : LIVE_CHAT_DEFAULTS.autoAwayMinutes,
    }
  } catch {
    // Table missing (pre-migration) → behave as queue-off.
    return { ...LIVE_CHAT_DEFAULTS }
  }
}
