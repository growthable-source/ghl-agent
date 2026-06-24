import { db } from '@/lib/db'
import SlaPolicyClient from './SlaPolicyClient'

type Props = { params: Promise<{ workspaceId: string }> }

export default async function SlaPage({ params }: Props) {
  const { workspaceId } = await params
  const initialPolicies = await db.slaPolicy.findMany({ where: { workspaceId } })

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>SLA Policies</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Set first-response and resolution targets per ticket priority. Attainment is measured against these in your support metrics and the operations dashboard. Leave a field blank to stop tracking it.
          </p>
        </div>
        <SlaPolicyClient workspaceId={workspaceId} initialPolicies={initialPolicies} />
      </div>
    </div>
  )
}
