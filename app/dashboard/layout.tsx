import DashboardSidebar from '@/components/dashboard/DashboardSidebar'
import Breadcrumbs from '@/components/dashboard/Breadcrumbs'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <DashboardSidebar />
      <main className="flex-1 overflow-y-auto flex flex-col min-h-0">
        <Breadcrumbs />
        <div className="flex-1">
          {children}
        </div>
      </main>
    </div>
  )
}
