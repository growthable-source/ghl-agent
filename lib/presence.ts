import { db } from './db'
import { isMissingColumn } from './migration-error'

/**
 * Member activity tracking for auto-away.
 *
 * "Activity" = the dashboard heartbeat (real pointer/keyboard input in
 * any /dashboard page, throttled client-side) or a high-signal server
 * action like sending a chat reply. Recording activity:
 *
 *   1. bumps WorkspaceMember.lastActivityAt — the auto-away cron only
 *      sweeps members with a non-null value, so this doubles as the
 *      per-member opt-in signal (nobody is swept before they've been
 *      seen active at least once post-rollout);
 *   2. auto-restores members the SYSTEM flipped away (presenceSource
 *      'system') back to Available — coming back to the keyboard is the
 *      whole signal auto-away runs on, so it must work both directions.
 *      Manual Away ('self') and kiosk-admin writes ('kiosk') are never
 *      overridden by activity.
 *
 * Best-effort by design: returns null when the activity columns aren't
 * migrated yet (feature silently off) — callers must not fail their
 * actual work over a presence bump.
 */
export async function recordMemberActivity(
  workspaceId: string,
  userId: string,
): Promise<{ isAvailable: boolean; restored: boolean } | null> {
  let member: { id: string; isAvailable: boolean | null; presenceSource: string | null } | null = null
  try {
    member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true, isAvailable: true, presenceSource: true } as any,
    }) as any
  } catch (err) {
    if (isMissingColumn(err)) return null
    throw err
  }
  if (!member) return null

  const restore = member.isAvailable === false && member.presenceSource === 'system'
  try {
    await db.workspaceMember.update({
      where: { id: member.id },
      data: {
        lastActivityAt: new Date(),
        ...(restore ? { isAvailable: true, availabilityChangedAt: new Date(), presenceSource: 'system' } : {}),
      } as any,
    })
  } catch (err) {
    if (isMissingColumn(err)) return null
    throw err
  }

  if (restore) {
    // Presence event log powers the members activity timeline. Best-effort —
    // the table may not be migrated in older workspaces.
    try {
      await (db as any).memberPresenceEvent.create({
        data: { memberId: member.id, workspaceId, state: 'available', source: 'system' },
      })
    } catch { /* timeline only */ }
  }

  return { isAvailable: restore ? true : member.isAvailable !== false, restored: restore }
}
