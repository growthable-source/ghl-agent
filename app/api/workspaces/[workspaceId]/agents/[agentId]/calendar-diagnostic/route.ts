import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getCrmAdapter } from '@/lib/crm/factory'
import { getTokens, getValidAccessToken } from '@/lib/token-store'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET /api/workspaces/:workspaceId/agents/:agentId/calendar-diagnostic
 *
 * Runs every prerequisite check for calendar booking, one at a time, and
 * reports exactly which step fails. No guessing.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const results: Array<{ step: string; status: 'ok' | 'fail' | 'warn'; detail: string; fix?: string }> = []

  // ─── 1. Agent exists + has location + calendarId ───
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: {
      id: true, name: true, locationId: true, calendarId: true,
      enabledTools: true, workspaceId: true,
    },
  })
  if (!agent) {
    results.push({ step: 'Agent exists', status: 'fail', detail: 'Agent not found in this workspace.' })
    return NextResponse.json({ ok: false, results })
  }
  results.push({ step: 'Agent exists', status: 'ok', detail: agent.name })

  // ─── 2. Booking tools enabled ───
  const hasSlotsTool = agent.enabledTools.includes('get_available_slots')
  const hasBookTool = agent.enabledTools.includes('book_appointment')
  if (!hasSlotsTool || !hasBookTool) {
    results.push({
      step: 'Booking tools enabled',
      status: 'fail',
      detail: `Missing: ${[!hasSlotsTool && 'get_available_slots', !hasBookTool && 'book_appointment'].filter(Boolean).join(', ')}`,
      fix: 'Open Agent → Tools tab and enable both. Picking a calendar now auto-enables them.',
    })
  } else {
    results.push({ step: 'Booking tools enabled', status: 'ok', detail: 'get_available_slots + book_appointment' })
  }

  // ─── 3. Calendar ID set on the agent ───
  if (!agent.calendarId) {
    results.push({
      step: 'Calendar ID configured',
      status: 'fail',
      detail: 'agent.calendarId is NULL. The agent has no calendar to use.',
      fix: 'Open Agent → Tools tab → pick a Connected Calendar.',
    })
  } else {
    results.push({ step: 'Calendar ID configured', status: 'ok', detail: agent.calendarId })
  }

  // ─── 4. OAuth token exists and is valid ───
  const tokens = await getTokens(agent.locationId)
  if (!tokens) {
    results.push({
      step: 'OAuth token stored',
      status: 'fail',
      detail: `No token stored for location ${agent.locationId}.`,
      fix: 'Reinstall the GHL app at Integrations → Connect.',
    })
    return NextResponse.json({ ok: false, results })
  }
  results.push({ step: 'OAuth token stored', status: 'ok', detail: `Expires ${new Date(tokens.expiresAt).toISOString()}` })

  // Check scope string — booking requires BOTH:
  //   calendars.readonly   → read calendars + free-slots
  //   calendars/events.write → CREATE appointments
  const scope = (tokens as any).scope || ''
  const haveCalRead = scope.includes('calendars.readonly')
  const haveCalWrite = scope.includes('calendars.write')
  const haveEventsRead = scope.includes('calendars/events.readonly')
  const haveEventsWrite = scope.includes('calendars/events.write')

  const missingScopes: string[] = []
  if (!haveCalRead) missingScopes.push('calendars.readonly')
  if (!haveEventsWrite) missingScopes.push('calendars/events.write')

  if (missingScopes.length > 0) {
    results.push({
      step: 'Calendar scopes granted',
      status: 'fail',
      detail: `Missing scope(s): ${missingScopes.join(', ')}. Current scopes: "${scope.slice(0, 200)}..."`,
      fix: `Reinstall the GHL app at Integrations — the current token was issued before all required calendar scopes were requested. calendars/events.write is needed to CREATE appointments (not just read calendars).`,
    })
  } else {
    results.push({
      step: 'Calendar scopes granted',
      status: 'ok',
      detail: `All scopes present: calendars.readonly ✓, calendars.write ${haveCalWrite ? '✓' : '—'}, calendars/events.readonly ${haveEventsRead ? '✓' : '—'}, calendars/events.write ✓`,
    })
  }

  // ─── 5. Access token refreshes cleanly ───
  const validToken = await getValidAccessToken(agent.locationId)
  if (!validToken) {
    results.push({
      step: 'Token is valid (refresh works)',
      status: 'fail',
      detail: 'getValidAccessToken returned null — refresh may have failed.',
      fix: 'Reinstall the GHL app to issue a fresh token.',
    })
    return NextResponse.json({ ok: false, results })
  }
  results.push({ step: 'Token is valid (refresh works)', status: 'ok', detail: 'token refreshed successfully' })

  // ─── 6. List calendars from GHL ───
  const crm = (await getCrmAdapter(agent.locationId)) as any
  let ghlCalendars: any[] = []
  try {
    // Hit the list-calendars route's underlying path directly
    const res = await fetch(`https://services.leadconnectorhq.com/calendars/?locationId=${agent.locationId}`, {
      headers: {
        'Authorization': `Bearer ${validToken}`,
        'Version': '2021-04-15',
        'Accept': 'application/json',
      },
    })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300)
      results.push({
        step: 'GHL calendar list returns data',
        status: 'fail',
        detail: `HTTP ${res.status}: ${body}`,
        fix: res.status === 401 ? 'Token rejected — reinstall.' : res.status === 403 ? 'Scopes missing — reinstall to grant calendars.readonly.' : 'GHL API error — check response body above.',
      })
      return NextResponse.json({ ok: false, results })
    }
    const data = await res.json()
    ghlCalendars = data.calendars || []
    results.push({
      step: 'GHL calendar list returns data',
      status: 'ok',
      detail: `${ghlCalendars.length} calendar(s) returned: ${ghlCalendars.slice(0, 3).map(c => c.name).join(', ')}${ghlCalendars.length > 3 ? '…' : ''}`,
    })
  } catch (err: any) {
    results.push({ step: 'GHL calendar list returns data', status: 'fail', detail: err.message })
    return NextResponse.json({ ok: false, results })
  }

  // ─── 7. Agent's calendarId appears in the list ───
  if (agent.calendarId) {
    const found = ghlCalendars.find(c => c.id === agent.calendarId)
    if (!found) {
      results.push({
        step: 'Agent calendarId matches a real GHL calendar',
        status: 'fail',
        detail: `agent.calendarId=${agent.calendarId} is not in this location's calendar list. Was it deleted or moved?`,
        fix: 'Pick a new calendar in Agent → Tools.',
      })
      return NextResponse.json({ ok: false, results })
    }
    results.push({
      step: 'Agent calendarId matches a real GHL calendar',
      status: 'ok',
      detail: `${found.name} (${found.id})`,
    })

    // ─── 7b. Calendar has a team member (required for booking) ───
    try {
      const teamUserId = await crm.pickCalendarTeamMember(agent.calendarId)
      if (teamUserId) {
        results.push({
          step: 'Calendar has an assignable team member',
          status: 'ok',
          detail: `Team member userId: ${teamUserId} (auto-assigned to new bookings)`,
        })
      } else {
        results.push({
          step: 'Calendar has an assignable team member',
          status: 'fail',
          detail: 'This calendar has NO team members configured. GHL will reject every booking with "A team member needs to be selected" (422).',
          fix: 'In GHL: open this calendar → Team & Availability tab → add at least one team member. Then retry booking.',
        })
      }
    } catch (err: any) {
      results.push({
        step: 'Calendar has an assignable team member',
        status: 'warn',
        detail: `Could not check team members: ${err.message}`,
      })
    }

    // ─── 8. Free slots query succeeds ───
    try {
      const slots = await crm.getFreeSlots(
        agent.calendarId,
        new Date().toISOString(),
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      )
      if (!slots || slots.length === 0) {
        results.push({
          step: 'Free slots query returns data',
          status: 'warn',
          detail: 'Query succeeded but returned 0 slots for the next 14 days. Calendar may genuinely have no availability, or calendar settings (business hours, min booking notice, team member assignment) block all slots.',
          fix: 'In GHL: check Calendar → Settings → Availability. Make sure working hours are set and the calendar has at least one team member assigned.',
        })
      } else {
        results.push({
          step: 'Free slots query returns data',
          status: 'ok',
          detail: `${slots.length} slots returned over next 14 days. First: ${slots[0].startTime}`,
        })
      }
    } catch (err: any) {
      results.push({
        step: 'Free slots query returns data',
        status: 'fail',
        detail: err.message,
        fix: /403|forbidden/i.test(err.message) ? 'Scopes — reinstall.'
          : /404/i.test(err.message) ? 'Calendar ID is stale — pick a new one.'
          : 'GHL API error — see error message above.',
      })
    }
  }

  const hasAnyFail = results.some(r => r.status === 'fail')
  return NextResponse.json({ ok: !hasAnyFail, results })
}
