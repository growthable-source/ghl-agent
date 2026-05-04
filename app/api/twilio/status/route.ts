import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Twilio status callback. Configured via the StatusCallback param on
 * outbound Messages (set in lib/native-outbox.ts). Twilio fires this
 * for every state transition: queued → sending → sent → delivered, or
 * → failed / undelivered.
 *
 * We map those states to NativeMessage.status:
 *   - 'sent' / 'delivered'    → 'delivered'
 *   - 'failed' / 'undelivered' → 'failed' (with ErrorMessage)
 *   - everything else          → ignored (intermediate states)
 *
 * The webhook is unauthenticated by design — Twilio doesn't sign
 * status callbacks with anything beyond the URL. If you need stronger
 * auth, put the URL behind an opaque path or check X-Twilio-Signature.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const messageSid = formData.get('MessageSid') as string | null
  const status = (formData.get('MessageStatus') as string | null)?.toLowerCase() ?? ''
  const errorCode = formData.get('ErrorCode') as string | null
  const errorMessage = formData.get('ErrorMessage') as string | null

  if (!messageSid) return new NextResponse('', { status: 200 })

  let nextStatus: string | null = null
  let providerError: string | null = null
  if (status === 'delivered' || status === 'sent') {
    nextStatus = 'delivered'
  } else if (status === 'failed' || status === 'undelivered') {
    nextStatus = 'failed'
    providerError = [errorCode, errorMessage].filter(Boolean).join(': ') || `Twilio reported ${status}`
  }

  if (!nextStatus) return new NextResponse('', { status: 200 })

  // Match by providerMessageId (the Twilio sid stored at send time).
  // updateMany is safe — providerMessageId is sufficiently unique that
  // we'll only ever hit one row per call.
  await db.nativeMessage.updateMany({
    where: { providerMessageId: messageSid },
    data: {
      status: nextStatus,
      ...(providerError ? { providerError } : {}),
    },
  })

  return new NextResponse('', { status: 200 })
}
