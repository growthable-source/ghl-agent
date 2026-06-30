import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import DashboardSidebar from '@/components/dashboard/DashboardSidebar'
import Breadcrumbs from '@/components/dashboard/Breadcrumbs'
import UserOnboardingModal from '@/components/dashboard/UserOnboardingModal'
import { EmbeddedProvider } from '@/lib/embedded-context'
import { SIGNUP_INTENT_COOKIE, readSignupIntent } from '@/lib/signup-intent'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  // Onboarding modal logic — three signals we care about:
  //   needsOnboarding         — user hasn't run through the onboarding
  //                             modal yet, OR has no workspace at all.
  //   existingWorkspaceId     — if the user ALREADY has a workspace
  //                             (created by the marketplace OAuth
  //                             callback before they ever saw a screen),
  //                             skip the workspace-create step of
  //                             onboarding and use the existing one.
  //   existingInstallSource   — drives the post-onboarding redirect:
  //                             marketplace installs jump straight to
  //                             /agents/new because the CRM question
  //                             is moot.
  let needsOnboarding = false
  let existingWorkspaceId: string | null = null
  let existingInstallSource: string | null = null

  if (session?.user) {
    // Fetch the oldest workspace this user belongs to — for marketplace
    // installs this is the one the OAuth callback created. Asking for
    // it once here is cheaper than rehydrating later inside the modal.
    const firstMembership = await db.workspaceMember.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        workspaceId: true,
        workspace: { select: { installSource: true } },
      },
    }).catch(() => null)

    if (firstMembership) {
      existingWorkspaceId = firstMembership.workspaceId
      existingInstallSource = (firstMembership.workspace as any).installSource ?? null
    }

    if (!session.user.onboardingCompletedAt) {
      needsOnboarding = true
    } else if (!existingWorkspaceId) {
      // Completed onboarding before the workspace refactor — needs to
      // make a new workspace now.
      needsOnboarding = true
    }
  }

  // Pre-signup intent (from /start): the visitor already told us their CRM +
  // business name before Google. Pass it in so onboarding pre-fills instead
  // of asking again.
  const signupIntent = needsOnboarding
    ? readSignupIntent((await cookies()).get(SIGNUP_INTENT_COOKIE)?.value)
    : null

  return (
    <EmbeddedProvider>
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
          existingWorkspaceId={existingWorkspaceId ?? undefined}
          existingInstallSource={existingInstallSource ?? undefined}
          signupCrm={signupIntent?.crm ?? undefined}
          signupCompany={signupIntent?.company ?? undefined}
        />
      )}
    </div>
    </EmbeddedProvider>
  )
}
