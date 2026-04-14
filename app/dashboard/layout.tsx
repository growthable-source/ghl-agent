import { auth } from '@/lib/auth'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar'
import Breadcrumbs from '@/components/dashboard/Breadcrumbs'
import UserOnboardingModal from '@/components/dashboard/UserOnboardingModal'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const needsOnboarding = session?.user && !session.user.onboardingCompletedAt

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto flex flex-col min-h-0">
        <Breadcrumbs />
        <div className="flex-1">
          {children}
        </div>
      </main>
      {needsOnboarding && <UserOnboardingModal />}
    </div>
  )
}
