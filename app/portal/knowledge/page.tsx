import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import PortalKnowledgeClient from '@/components/portal/PortalKnowledgeClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Knowledge · Customer Portal',
  robots: { index: false, follow: false },
}

export default async function PortalKnowledge() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  if (session.brandIds.length === 0) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold text-white">Knowledge</h1>
        <p className="text-sm text-zinc-400 mt-2">No brands assigned yet.</p>
      </div>
    )
  }

  const brands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { id: true, name: true, primaryColor: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-white">Knowledge</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Teach the AI about your brand. Everything here is used when the support team drafts replies to your customers — add your docs and links, keep a library of reusable snippets, and set words the AI should never use.
        </p>
      </div>
      <PortalKnowledgeClient brands={brands} />
    </div>
  )
}
