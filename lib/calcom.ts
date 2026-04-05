/**
 * Cal.com Integration
 * Wraps Cal.com API v2 for scheduling.
 */

const CALCOM_BASE = 'https://api.cal.com/v2'

async function calcomRequest(path: string, apiKey: string, options: RequestInit = {}) {
  const res = await fetch(`${CALCOM_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'cal-api-version': '2024-08-13',
      ...options.headers,
    },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Cal.com API error ${res.status}: ${err}`)
  }
  return res.json()
}

export async function getCalcomMe(apiKey: string) {
  const data = await calcomRequest('/me', apiKey)
  return data.data
}

export async function listCalcomEventTypes(apiKey: string) {
  const data = await calcomRequest('/event-types', apiKey)
  return (data.data || []).map((et: any) => ({
    id: et.id,
    slug: et.slug,
    title: et.title,
    description: et.description,
    length: et.lengthInMinutes || et.length,
    locations: et.locations,
  }))
}

export async function getCalcomAvailability(
  apiKey: string,
  eventTypeId: number,
  startTime: string,
  endTime: string
) {
  const params = new URLSearchParams({
    startTime,
    endTime,
    eventTypeId: String(eventTypeId),
  })
  const data = await calcomRequest(`/slots?${params}`, apiKey)
  // Cal.com returns { data: { slots: { "2024-01-15": [{ time: "..." }] } } }
  const slotsObj = data.data?.slots || {}
  const allSlots: { date: string; time: string }[] = []
  for (const [date, times] of Object.entries(slotsObj)) {
    for (const slot of times as any[]) {
      allSlots.push({ date, time: slot.time })
    }
  }
  return allSlots
}

export async function createCalcomBooking(
  apiKey: string,
  opts: {
    eventTypeId: number
    start: string
    attendee: { name: string; email: string; timeZone?: string }
    metadata?: Record<string, string>
  }
) {
  const data = await calcomRequest('/bookings', apiKey, {
    method: 'POST',
    body: JSON.stringify({
      eventTypeId: opts.eventTypeId,
      start: opts.start,
      attendee: {
        name: opts.attendee.name,
        email: opts.attendee.email,
        timeZone: opts.attendee.timeZone || 'UTC',
      },
      metadata: opts.metadata || {},
    }),
  })
  return {
    id: data.data?.id,
    uid: data.data?.uid,
    status: data.data?.status,
    startTime: data.data?.start,
    endTime: data.data?.end,
  }
}

export async function cancelCalcomBooking(apiKey: string, bookingId: number, reason?: string) {
  await calcomRequest(`/bookings/${bookingId}/cancel`, apiKey, {
    method: 'POST',
    body: JSON.stringify({ cancellationReason: reason || 'Cancelled via Voxility AI' }),
  })
  return { success: true }
}

export async function listCalcomBookings(
  apiKey: string,
  opts: { status?: string; afterStart?: string; beforeEnd?: string } = {}
) {
  const params = new URLSearchParams()
  if (opts.status) params.set('status', opts.status)
  if (opts.afterStart) params.set('afterStart', opts.afterStart)
  if (opts.beforeEnd) params.set('beforeEnd', opts.beforeEnd)

  const data = await calcomRequest(`/bookings?${params}`, apiKey)
  return (data.data || []).map((b: any) => ({
    id: b.id,
    uid: b.uid,
    title: b.title,
    status: b.status,
    startTime: b.start,
    endTime: b.end,
    attendees: b.attendees,
  }))
}
