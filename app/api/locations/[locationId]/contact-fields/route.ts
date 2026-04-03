import { NextRequest, NextResponse } from 'next/server'
import { getCustomFields } from '@/lib/crm-client'

type Params = { params: Promise<{ locationId: string }> }

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
  const { locationId } = await params

  const customFields = await getCustomFields(locationId)

  return NextResponse.json({
    fields: [
      ...STANDARD_FIELDS,
      ...customFields.map(f => ({ ...f, group: 'Custom' })),
    ],
  })
}
