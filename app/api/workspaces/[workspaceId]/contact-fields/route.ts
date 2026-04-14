import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCustomFields } from '@/lib/crm-client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

// Standard GHL contact fields
const STANDARD_FIELDS = [
  { id: 'firstName', name: 'First Name', fieldKey: 'firstName', dataType: 'TEXT', group: 'Standard' },
  { id: 'lastName', name: 'Last Name', fieldKey: 'lastName', dataType: 'TEXT', group: 'Standard' },
  { id: 'email', name: 'Email', fieldKey: 'email', dataType: 'EMAIL', group: 'Standard' },
  { id: 'phone', name: 'Phone', fieldKey: 'phone', dataType: 'PHONE', group: 'Standard' },
  { id: 'address1', name: 'Address', fieldKey: 'address1', dataType: 'TEXT', group: 'Standard' },
  { id: 'city', name: 'City', fieldKey: 'city', dataType: 'TEXT', group: 'Standard' },
  { id: 'state', name: 'State / Province', fieldKey: 'state', dataType: 'TEXT', group: 'Standard' },
  { id: 'postalCode', name: 'Postal Code', fieldKey: 'postalCode', dataType: 'TEXT', group: 'Standard' },
  { id: 'country', name: 'Country', fieldKey: 'country', dataType: 'TEXT', group: 'Standard' },
  { id: 'companyName', name: 'Company Name', fieldKey: 'companyName', dataType: 'TEXT', group: 'Standard' },
  { id: 'website', name: 'Website', fieldKey: 'website', dataType: 'TEXT', group: 'Standard' },
  { id: 'source', name: 'Lead Source', fieldKey: 'source', dataType: 'TEXT', group: 'Standard' },
  { id: 'dateOfBirth', name: 'Date of Birth', fieldKey: 'dateOfBirth', dataType: 'DATE', group: 'Standard' },
]

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Get the first location for this workspace to fetch CRM custom fields
  const location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'No location found for workspace' }, { status: 404 })

  const customFields = await getCustomFields(location.id)

  return NextResponse.json({
    fields: [
      ...STANDARD_FIELDS,
      ...customFields.map(f => ({ ...f, group: 'Custom' })),
    ],
  })
}
