import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import PortalTicketDetailClient from '@/components/portal/PortalTicketDetailClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Ticket · Customer Portal',
  robots: { index: false, follow: false },
}

/**
 * Portal ticket workspace — the brand-side detail view behind the
 * tickets list. The server component only authorizes (session + the
 * ticket's brand must be in session.brandIds); the client handles the
 * thread, status changes, replies, and pending-draft sign-off through
 * /api/portal/tickets/[ticketId].
 */
export default async function PortalTicketDetailPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const { ticketId } = await params
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, brandId: true },
  }).catch(() => null)
  if (!ticket || !ticket.brandId || !session.brandIds.includes(ticket.brandId)) notFound()

  return <PortalTicketDetailClient ticketId={ticketId} />
}
