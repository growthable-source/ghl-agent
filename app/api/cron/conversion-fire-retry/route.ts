/**
 * Conversion-fire retry cron.
 *
 * The form-submit handler fires conversions in the background. Anything
 * that didn't go through (network blip, transient 5xx, integration that
 * hadn't been provisioned at submit time) lands here.
 *
 * Selection: rows whose Meta OR Google side has neither been sent nor
 * marked with a non-retryable config error, AND that are at least 60
 * seconds old (avoids racing the in-flight background fire from
 * form-submit). Caps batch at 50 per tick to stay well under maxDuration.
 *
 * Secured by CRON_SECRET (shared pattern with the other crons).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fireConversion, isRetryableConversionError } from '@/lib/conversion-fire'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BATCH_SIZE = 50
const MIN_AGE_SECONDS = 60

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided =
    req.nextUrl.searchParams.get('secret') ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - MIN_AGE_SECONDS * 1000)

  // Pull anything where either side is unsent AND has either no error
  // or a retryable error. We run isRetryableConversionError client-side
  // since Postgres can't easily evaluate that classification rule.
  const candidates = await db.conversionEvent.findMany({
    where: {
      createdAt: { lte: cutoff },
      OR: [{ metaSentAt: null }, { googleSentAt: null }],
    },
    select: { id: true, metaSentAt: true, metaError: true, googleSentAt: true, googleError: true },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE * 4, // over-fetch so we have enough after filtering
  })

  const targets = candidates.filter((e) => {
    const metaPending = !e.metaSentAt && (e.metaError === null || isRetryableConversionError(e.metaError))
    const googlePending = !e.googleSentAt && (e.googleError === null || isRetryableConversionError(e.googleError))
    return metaPending || googlePending
  }).slice(0, BATCH_SIZE)

  let attempted = 0
  let metaSent = 0
  let googleSent = 0
  let metaFailed = 0
  let googleFailed = 0

  for (const target of targets) {
    attempted++
    const result = await fireConversion(target.id)
    if (result.meta?.ok) metaSent++
    else if (result.meta && result.meta.reason !== 'already_sent' && result.meta.reason !== 'not_configured') metaFailed++
    if (result.google?.ok) googleSent++
    else if (result.google && result.google.reason !== 'already_sent' && result.google.reason !== 'not_configured' && result.google.reason !== 'no_gclid') googleFailed++
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    attempted,
    meta: { sent: metaSent, failed: metaFailed },
    google: { sent: googleSent, failed: googleFailed },
  })
}
