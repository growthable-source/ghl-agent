/**
 * Calendly Integration
 * Wraps Calendly API v2 for scheduling.
 */

const CALENDLY_BASE = 'https://api.calendly.com'

async function calendlyRequest(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${CALENDLY_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Calendly API error ${res.status}: ${err}`)
  }
  return res.json()
}

export async function getCalendlyUser(token: string) {
  const data = await calendlyRequest('/users/me', token)
  return data.resource
}

export async function listEventTypes(token: string, userUri: string) {
  const data = await calendlyRequest(
    `/event_types?user=${encodeURIComponent(userUri)}&active=true`,
    token
  )
  return (data.collection || []).map((et: any) => ({
    uri: et.uri,
    name: et.name,
    slug: et.slug,
    duration: et.duration,
    schedulingUrl: et.scheduling_url,
    color: et.color,
    active: et.active,
  }))
}

export async function listScheduledEvents(
  token: string,
  userUri: string,
  opts: { minStartTime?: string; maxStartTime?: string; count?: number } = {}
) {
  const params = new URLSearchParams({ user: userUri })
  if (opts.minStartTime) params.set('min_start_time', opts.minStartTime)
  if (opts.maxStartTime) params.set('max_start_time', opts.maxStartTime)
  if (opts.count) params.set('count', String(opts.count))
  params.set('status', 'active')

  const data = await calendlyRequest(`/scheduled_events?${params}`, token)
  return (data.collection || []).map((ev: any) => ({
    uri: ev.uri,
    name: ev.name,
    status: ev.status,
    startTime: ev.start_time,
    endTime: ev.end_time,
    eventType: ev.event_type,
    location: ev.location,
  }))
}

export async function getEventInvitees(token: string, eventUri: string) {
  const uuid = eventUri.split('/').pop()
  const data = await calendlyRequest(`/scheduled_events/${uuid}/invitees`, token)
  return (data.collection || []).map((inv: any) => ({
    uri: inv.uri,
    name: inv.name,
    email: inv.email,
    status: inv.status,
    createdAt: inv.created_at,
  }))
}

export async function cancelEvent(token: string, eventUri: string, reason?: string) {
  const uuid = eventUri.split('/').pop()
  await calendlyRequest(`/scheduled_events/${uuid}/cancellation`, token, {
    method: 'POST',
    body: JSON.stringify({ reason: reason || 'Cancelled via Voxility AI' }),
  })
  return { success: true }
}

export async function getAvailability(token: string, eventTypeUri: string, startTime: string, endTime: string) {
  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: startTime,
    end_time: endTime,
  })
  const data = await calendlyRequest(`/event_type_available_times?${params}`, token)
  return (data.collection || []).map((slot: any) => ({
    status: slot.status,
    startTime: slot.start_time,
    inviteesRemaining: slot.invitees_remaining,
  }))
}
