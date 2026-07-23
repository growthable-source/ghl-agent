import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  listPhoneNumbers,
  purchasePhoneNumber,
  VAPI_PURCHASEABLE_COUNTRIES,
  type VapiPurchaseableCountry,
} from '@/lib/vapi-client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  try {

    const [config, agent] = await Promise.all([
      db.vapiConfig.findUnique({ where: { agentId } }),
      db.agent.findUnique({ where: { id: agentId } }),
    ])

    let phoneNumbers: { id: string; number: string | null; name: string; provider?: string; status?: string }[] = []
    let vapiError: string | null = null
    try {
      phoneNumbers = await listPhoneNumbers()
      console.log('[Vapi] phoneNumbers mapped:', JSON.stringify(phoneNumbers))
    } catch (err: any) {
      vapiError = err.message
      console.error('[Vapi] listPhoneNumbers failed:', err.message)
    }

    const rawKey = process.env.VAPI_API_KEY
    const vapiReady = !!rawKey && rawKey.trim().length > 0
    const vapiPublicKey = process.env.VAPI_PUBLIC_KEY || null

    // Voice-minute quota — surfaced so the browser test panel can show
    // the upgrade nudge BEFORE attempting vapi.start (otherwise the user
    // experiences a connection that's then torn down mid-handshake).
    // Same gate as the outbound dial uses; brand-neutral copy.
    //
    // (This route used to also assemble a `testSystemPrompt` and a
    // `voiceBlock` for the browser to pass to vapi.start — dead since
    // the browser started referencing the registered assistant by id.)
    const { checkVoiceQuota } = await import('@/lib/voice-quota')
    const voiceQuota = await checkVoiceQuota(workspaceId)

    return NextResponse.json({
      config,
      phoneNumbers,
      vapiReady,
      vapiError,
      vapiPublicKey,
      agentName: agent?.name || 'Agent',
      agentPersonaName: agent?.agentPersonaName || null,
      // The registered Vapi assistant id — what the browser passes
      // to vapi.start(assistantId, overrides). Falls back to null
      // when the agent doesn't have one yet (lazy backfill happens
      // on next save or call).
      vapiAssistantId: config?.vapiAssistantId ?? null,
      // { blocked: false, used, limit } when the workspace can dial;
      // { blocked: true, code, message, used, limit, planLabel } when over.
      voiceQuota: voiceQuota.ok
        ? { blocked: false, used: voiceQuota.used, limit: voiceQuota.limit }
        : {
            blocked: true,
            code: voiceQuota.code,
            message: voiceQuota.message,
            used: voiceQuota.used,
            limit: voiceQuota.limit,
            planLabel: voiceQuota.planLabel,
          },
      serverUrl: `${process.env.APP_URL || 'https://app.xovera.io'}/api/vapi/webhook`,
    })
  } catch (err: any) {
    console.error('[Vapi Route] CRASH:', err)
    return NextResponse.json({
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5),
    }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  const config = await db.vapiConfig.upsert({
    where: { agentId },
    create: { agentId, ...body },
    update: body,
  })

  // Saving the Vapi config commits this agent to the Vapi runtime. This
  // self-heals any agent still flagged 'gemini' from the retired
  // browser-direct Gemini stack: opening the (now unified) voice page and
  // hitting Save migrates it cleanly, no SQL required.
  await db.agent.update({ where: { id: agentId }, data: { voiceRuntime: 'vapi' } })

  // Sync the registered Vapi assistant with the new config. This is
  // the validation gate — if Vapi rejects any field, we return the
  // typed error so the UI can render it inline next to the save
  // button instead of letting the user discover it later as a
  // "Meeting ended due to ejection" on the test call.
  let vapiAssistantId: string | null = config.vapiAssistantId ?? null
  let vapiSyncError: { message: string; code?: string } | null = null
  try {
    const { syncVapiAssistant } = await import('@/lib/voice/vapi-assistant')
    const { VapiError } = await import('@/lib/vapi-client')
    try {
      vapiAssistantId = await syncVapiAssistant(agentId)
    } catch (err: any) {
      if (err instanceof VapiError) {
        vapiSyncError = { message: err.userMessage, code: err.code }
      } else {
        vapiSyncError = { message: err?.message ?? 'Vapi sync failed' }
      }
      console.warn(`[VapiConfig PUT] sync failed for ${agentId}:`, vapiSyncError.message)
    }
  } catch (err: any) {
    console.warn(`[VapiConfig PUT] module load failed for ${agentId}:`, err?.message)
  }

  // If sync failed, return 4xx so the form treats it as an error to
  // show inline. The VapiConfig row itself was already saved (lets
  // the operator re-trigger sync from the Retry button without
  // re-typing everything).
  if (vapiSyncError) {
    return NextResponse.json(
      { config, vapiAssistantId, error: vapiSyncError.message, code: vapiSyncError.code },
      { status: 422 },
    )
  }
  return NextResponse.json({ config, vapiAssistantId })
}

// PATCH — re-sync the registered Vapi assistant from current DB state,
// without writing any config. The test-call preflight uses this to
// self-heal an agent whose registration failed at create time, instead
// of bouncing the user to the Configuration tab to hit Save.
export async function PATCH(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  try {
    const { syncVapiAssistant } = await import('@/lib/voice/vapi-assistant')
    const vapiAssistantId = await syncVapiAssistant(agentId)
    return NextResponse.json({ vapiAssistantId })
  } catch (err: any) {
    const { VapiError } = await import('@/lib/vapi-client')
    const message = err instanceof VapiError ? err.userMessage : (err?.message ?? 'Vapi sync failed')
    return NextResponse.json({ error: message, code: err?.code }, { status: 422 })
  }
}

// POST — purchase a new phone number. Accepts:
//   { countryCode: 'US', areaCode?: string }
// Defaults to US for back-compat with older clients passing only areaCode.
// Vapi only provisions US numbers; anything else is rejected here rather
// than failing downstream with a raw carrier error.
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const countryCode = String(body.countryCode || 'US').toUpperCase()
  if (!VAPI_PURCHASEABLE_COUNTRIES.includes(countryCode as VapiPurchaseableCountry)) {
    return NextResponse.json(
      {
        error: `Only ${VAPI_PURCHASEABLE_COUNTRIES.join(', ')} numbers can be bought here. For international numbers, create a Gemini voice agent.`,
      },
      { status: 400 },
    )
  }
  const areaCode = String(body.areaCode || '').trim()

  try {
    const phone = await purchasePhoneNumber({ countryCode, areaCode: areaCode || undefined })
    return NextResponse.json({ phone })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.userMessage || err?.message, code: err?.code },
      { status: 400 },
    )
  }
}
