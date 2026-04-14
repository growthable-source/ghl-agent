import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

const VALID_SIZES = ['1', '2-10', '11-50', '51-200', '201-1000', '1000+']
const VALID_ROLES = ['founder', 'marketing', 'sales', 'operations', 'developer', 'agency', 'other']

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { companyName, companySize, role } = body

  const data: Record<string, unknown> = {
    onboardingCompletedAt: new Date(),
  }

  if (companyName && typeof companyName === 'string') {
    data.companyName = companyName.trim().slice(0, 200)
  }
  if (companySize && VALID_SIZES.includes(companySize)) {
    data.companySize = companySize
  }
  if (role && VALID_ROLES.includes(role)) {
    data.role = role
  }

  const user = await db.user.update({
    where: { id: session.user.id },
    data,
    select: {
      id: true,
      name: true,
      email: true,
      companyName: true,
      companySize: true,
      role: true,
      onboardingCompletedAt: true,
    },
  })

  return NextResponse.json({ user })
}
