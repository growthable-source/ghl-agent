import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * PATCH — update the WidgetVisitor's name / email / phone from the
 * operator. Used by the "User info" sidebar panel.
 *
 * Side effect: if the workspace runs the native CRM AND the visitor
 * isn't already linked to a NativeContact, this also upserts one
 * (matched by email/phone within the workspace) and stamps
 * WidgetVisitor.crmContactId so the CrmContextSection picks it up
 * on next render.
 *
 * No external CRM (GHL / HubSpot) sync here — that already runs from
 * the widget's /visitor identify endpoint on the customer's side.
 * Operator-driven edits are about getting the data into our own CRM.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    include: { visitor: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  // Normalise — empty string clears, undefined leaves alone.
  const updates: Record<string, unknown> = {}
  if ('name' in body) {
    const v = typeof body.name === 'string' ? body.name.trim() : ''
    updates.name = v || null
  }
  if ('email' in body) {
    const raw = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (raw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      return NextResponse.json({ error: 'Email is not a valid address.' }, { status: 400 })
    }
    updates.email = raw || null
  }
  if ('phone' in body) {
    const v = typeof body.phone === 'string' ? body.phone.trim() : ''
    // Light normalisation: keep digits, +, and spaces — enough for
    // the operator-facing display. Heavier E.164 normalisation lives
    // in the native CRM layer when we actually try to send via Twilio.
    updates.phone = v || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const visitor = await db.widgetVisitor.update({
    where: { id: convo.visitor.id },
    data: updates,
    select: { id: true, name: true, email: true, phone: true, crmContactId: true },
  })

  // ── Native CRM sync ────────────────────────────────────────────────
  // Try to ensure a NativeContact exists when the workspace uses the
  // native CRM. We only do this for native — the external-CRM bridge
  // is owned by lib/widget-crm-sync.ts and runs from a different path.
  let nativeContact: { id: string; created: boolean } | null = null
  const isNative = await isNativeCrmWorkspace(workspaceId)
  if (isNative && (visitor.email || visitor.phone)) {
    nativeContact = await upsertNativeContact({
      workspaceId,
      name: visitor.name,
      email: visitor.email,
      phone: visitor.phone,
      existingCrmContactId: visitor.crmContactId,
    })
    if (nativeContact && !visitor.crmContactId) {
      await db.widgetVisitor.update({
        where: { id: visitor.id },
        data: { crmContactId: nativeContact.id },
      })
    }
  }

  return NextResponse.json({
    visitor,
    nativeContact,
    nativeCrmEnabled: isNative,
  })
}

async function isNativeCrmWorkspace(workspaceId: string): Promise<boolean> {
  try {
    const native = await db.location.findFirst({
      where: { workspaceId, crmProvider: 'native' },
      select: { id: true },
    })
    return !!native
  } catch {
    return false
  }
}

interface UpsertInput {
  workspaceId: string
  name: string | null
  email: string | null
  phone: string | null
  existingCrmContactId: string | null
}

/**
 * Resolve the right NativeContact and update its fields.
 *
 * Lookup order: existing link → email match → phone match → create.
 * Returns { id, created } so the caller can stamp the link and the
 * UI can show "Created a CRM record" the first time.
 */
async function upsertNativeContact(p: UpsertInput): Promise<{ id: string; created: boolean } | null> {
  try {
    const [firstName, ...rest] = (p.name || '').trim().split(/\s+/)
    const lastName = rest.join(' ') || null

    let existing: { id: string } | null = null
    if (p.existingCrmContactId) {
      existing = await (db as any).nativeContact.findUnique({
        where: { id: p.existingCrmContactId },
        select: { id: true },
      }).catch(() => null)
    }
    if (!existing && p.email) {
      existing = await (db as any).nativeContact.findFirst({
        where: { workspaceId: p.workspaceId, email: p.email },
        select: { id: true },
      })
    }
    if (!existing && p.phone) {
      existing = await (db as any).nativeContact.findFirst({
        where: { workspaceId: p.workspaceId, phone: p.phone },
        select: { id: true },
      })
    }

    if (existing) {
      await (db as any).nativeContact.update({
        where: { id: existing.id },
        data: {
          firstName: firstName || null,
          lastName,
          email: p.email,
          phone: p.phone,
        },
      })
      return { id: existing.id, created: false }
    }

    const created = await (db as any).nativeContact.create({
      data: {
        workspaceId: p.workspaceId,
        firstName: firstName || null,
        lastName,
        email: p.email,
        phone: p.phone,
        source: 'inbox',
      },
      select: { id: true },
    })
    return { id: created.id, created: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[visitor PATCH] native upsert failed:', msg)
    return null
  }
}
