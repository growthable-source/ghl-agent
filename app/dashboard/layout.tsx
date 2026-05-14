import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar'
import Breadcrumbs from '@/components/dashboard/Breadcrumbs'
import UserOnboardingModal from '@/components/dashboard/UserOnboardingModal'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  // Show onboarding if user hasn't completed it OR has no workspaces
  let needsOnboarding = false
  if (session?.user) {
    if (!session.user.onboardingCompletedAt) {
      needsOnboarding = true
    } else {
      // Check if user actually has workspaces — they may have completed onboarding
      // before the workspace refactor, so they need to create one now
      const memberCount = await db.workspaceMember.count({
        where: { userId: session.user.id },
      })
      if (memberCount === 0) needsOnboarding = true
    }
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar />
      {/* main itself doesn't scroll — the children wrapper does. This
          flip is what lets full-viewport pages like the inbox use
          `h-full` and have their composer stick to the bottom. With
          the old `main { overflow-y-auto }`, h-full on the inbox
          resolved against an unbounded scrolling parent and the page
          grew past the viewport (operators had to scroll to find the
          reply box). Content-only pages still scroll fine — the
          overflow now lives one level in, on the children wrapper. */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Breadcrumbs />
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {children}
        </div>
      </main>
      {needsOnboarding && (
        <UserOnboardingModal
          userEmail={session!.user.email ?? undefined}
          userName={session!.user.name ?? undefined}
        />
      )}
    </div>
  )
}
