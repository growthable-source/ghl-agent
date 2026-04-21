import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'
import { toCsv, csvResponse, ADMIN_EXPORT_ROW_CAP } from '@/lib/admin-csv'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const where: any = {}
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { id: { contains: q } },
    ]
  }

  const users = await db.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: ADMIN_EXPORT_ROW_CAP,
    select: {
      id: true, name: true, email: true, companyName: true, companySize: true,
      role: true, theme: true,
      createdAt: true, updatedAt: true, onboardingCompletedAt: true, emailVerified: true,
      workspaces: {
        select: { role: true, workspace: { select: { id: true, name: true, plan: true } } },
      },
    },
  })

  const rows: Array<Array<string | number | null>> = [[
    'id', 'name', 'email', 'companyName', 'companySize', 'role', 'theme',
    'createdAt', 'updatedAt', 'onboardingCompletedAt', 'emailVerified',
    'workspaceCount', 'workspaceNames', 'workspacePlans', 'workspaceRoles',
  ]]
  for (const u of users) {
    const names = u.workspaces.map(m => m.workspace.name).join('|')
    const plans = u.workspaces.map(m => m.workspace.plan).join('|')
    const roles = u.workspaces.map(m => m.role).join('|')
    rows.push([
      u.id, u.name ?? '', u.email ?? '', u.companyName ?? '', u.companySize ?? '',
      u.role ?? '', u.theme,
      u.createdAt.toISOString(), u.updatedAt.toISOString(),
      u.onboardingCompletedAt?.toISOString() ?? '',
      u.emailVerified?.toISOString() ?? '',
      u.workspaces.length, names, plans, roles,
    ])
  }

  logAdminAction({
    admin: session,
    action: 'export_users_csv',
    meta: { q, rowCount: users.length },
  }).catch(() => {})

  const stamp = new Date().toISOString().slice(0, 10)
  return csvResponse(`voxility-users-${stamp}.csv`, toCsv(rows))
}
