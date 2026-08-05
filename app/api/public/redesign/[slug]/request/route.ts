/**
 * "Yes, build me one" — the redesign offer's capture.
 *
 *   POST /api/public/redesign/{slug}/request  { name, email, notes? }
 *
 * Unauthenticated by necessity: the prospect arrives from a cold email and
 * has no account. The slug is the credential — it is unguessable, scoped to
 * one prospect, and the route can only ever stamp that one row, so the worst
 * a caller can do with a slug they already possess is re-submit their own
 * request. No enumeration surface: an unknown slug 404s the same as a
 * deleted one.
 *
 * Idempotent: a prospect who submits twice (double-click, second visit)
 * updates their contact details rather than losing the original request
 * timestamp, which is what the work queue orders by.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    email?: string
    notes?: string
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : ''

  if (!name) {
    return NextResponse.json({ error: 'Please tell us your name.' }, { status: 400 })
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json(
      { error: 'Please give us a valid email so we can send the preview.' },
      { status: 400 },
    )
  }

  const prospect = await db.demoProspect
    .findUnique({ where: { slug }, select: { id: true, redesignRequestedAt: true } })
    .catch(() => null)
  if (!prospect) {
    return NextResponse.json({ error: 'This link is no longer active.' }, { status: 404 })
  }

  await db.demoProspect.update({
    where: { id: prospect.id },
    data: {
      // First submission sets the clock; a re-submit must not reset the
      // prospect's place in the queue.
      redesignRequestedAt: prospect.redesignRequestedAt ?? new Date(),
      redesignContact: { name, email, notes: notes || null } as Prisma.InputJsonValue,
      // The engine polls contactEmail; a prospect who gives a different address
      // here is telling us where they actually read mail.
      contactEmail: email,
    },
  })

  return NextResponse.json({ ok: true })
}
