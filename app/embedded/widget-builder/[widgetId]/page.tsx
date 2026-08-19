/**
 * The partner-embedded widget builder.
 *
 * Chrome-less by design: no sidebar, no back link, no delete. A customer
 * arriving from a partner's admin UI is editing one widget and nothing
 * else — routing, per-location agency controls and install snippets stay
 * on the full dashboard page.
 *
 * Auth comes from the embed session cookie the handshake set. /embedded
 * is outside middleware's dashboard gate, so this page does its own
 * session + membership check rather than assuming one ran.
 */
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { getEffectivePlan } from '@/lib/effective-plan'
import EmbeddedWidgetBuilder from './EmbeddedWidgetBuilder'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ widgetId: string }> }) {
  const { widgetId } = await params
  const session = await auth()

  // No session means the handshake never ran (or the browser dropped the
  // SameSite=None cookie). Sending them to /login inside a narrow iframe
  // would be a dead end, so say what actually happened instead.
  if (!session?.user?.id) return <SignedOut reason="no_session" />

  const widget = await db.chatWidget.findUnique({
    where: { id: widgetId },
    select: {
      id: true, name: true, workspaceId: true, type: true, embedMode: true,
      primaryColor: true, backgroundColor: true, textColor: true,
      logoUrl: true, title: true, subtitle: true,
      welcomeMessage: true, position: true, launcherIcon: true,
      launcherLetter: true, isActive: true, publicKey: true,
    },
  })
  if (!widget) return <SignedOut reason="no_widget" />

  // The cookie proves who they are; this proves they may touch THIS
  // widget. Never infer access from the token alone.
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: widget.workspaceId } },
    select: { role: true },
  })
  if (!member) return <SignedOut reason="no_access" />
  if (member.role === 'viewer') return <SignedOut reason="read_only" />

  const plan = await getEffectivePlan(widget.workspaceId).catch(() => null)

  return (
    <EmbeddedWidgetBuilder
      initialWidget={widget}
      workspaceId={widget.workspaceId}
      trial={plan && plan.plan === 'trial' ? {
        endsAt: plan.trialEndsAt ? plan.trialEndsAt.toISOString() : null,
        expired: plan.trialExpired,
      } : null}
    />
  )
}

function SignedOut({ reason }: { reason: 'no_session' | 'no_widget' | 'no_access' | 'read_only' }) {
  const copy: Record<typeof reason, string> = {
    no_session: 'Your session has expired, or your browser is blocking cookies inside this panel.',
    no_widget: 'That widget no longer exists.',
    no_access: 'Your account does not have access to this widget.',
    read_only: 'Your account has view-only access, so you cannot change the widget here.',
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-950">
      <div className="max-w-sm text-center">
        <p className="text-3xl mb-3">🔒</p>
        <p className="text-sm text-zinc-100 font-semibold mb-1">{copy[reason]}</p>
        {reason === 'no_session' && (
          <p className="text-xs text-zinc-500">
            Close this panel and click “Customise widget” again. If it keeps happening,
            allow third-party cookies for this site.
          </p>
        )}
      </div>
    </div>
  )
}
