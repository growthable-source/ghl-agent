import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import AcceptInviteForm from './AcceptInviteForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Accept invitation · Customer Portal',
  robots: { index: false, follow: false },
}

type Params = { params: Promise<{ token: string }> }

export default async function AcceptInvitePage({ params }: Params) {
  const { token } = await params

  const tokenHash = createHash('sha256').update(token).digest('hex')

  // Look up the invite directly here so we can render a meaningful
  // "this invite expired / was already accepted" page rather than the
  // POST endpoint blowing up later.
  const invite = await db.portalInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true, email: true, expiresAt: true, acceptedAt: true,
      portal: { select: { id: true, name: true, primaryColor: true, logoUrl: true } },
    },
  })

  const accent = invite?.portal.primaryColor?.trim() || '#fbbf24'

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6 py-12"
      style={{ ['--portal-accent']: accent } as React.CSSProperties}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          {invite?.portal.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={invite.portal.logoUrl} alt={invite.portal.name} className="h-9 mx-auto mb-3" />
          ) : (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--portal-accent)]">
              {invite ? invite.portal.name : 'Xovera'}
            </p>
          )}
          <h1 className="text-2xl font-semibold text-white mt-2">
            {invite ? invite.portal.name : 'Customer Portal'}
          </h1>
        </div>

        {!invite ? (
          <Notice>
            This invitation link is invalid. Ask your account contact to send a fresh one.
          </Notice>
        ) : invite.acceptedAt ? (
          <Notice>
            This invitation has already been accepted. <a href="/portal/login" className="text-[var(--portal-accent)] hover:opacity-80">Sign in →</a>
          </Notice>
        ) : invite.expiresAt < new Date() ? (
          <Notice>
            This invitation has expired. Ask your account contact for a new one.
          </Notice>
        ) : (
          <>
            <p className="text-sm text-zinc-400 text-center mb-5">
              Set a password for <span className="text-zinc-200">{invite.email}</span> to finish setup.
            </p>
            <AcceptInviteForm token={token} />
          </>
        )}
      </div>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-zinc-800 bg-zinc-900/40 rounded-lg p-5 text-sm text-zinc-300 text-center">
      {children}
    </div>
  )
}
