import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(db) as any,
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID ? [Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })] : []),
    ...(process.env.GITHUB_CLIENT_ID ? [GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    })] : []),
  ],
  pages: {
    signIn: '/login',
    error: '/login',
  },
  events: {
    // When a user signs in, auto-accept any pending workspace invites
    async signIn({ user }) {
      if (!user?.email) return
      try {
        const pendingInvites = await db.workspaceInvite.findMany({
          where: { email: user.email, acceptedAt: null, expiresAt: { gt: new Date() } },
        })
        for (const invite of pendingInvites) {
          await db.workspaceMember.upsert({
            where: { userId_workspaceId: { userId: user.id!, workspaceId: invite.workspaceId } },
            create: { userId: user.id!, workspaceId: invite.workspaceId, role: invite.role },
            update: {},
          })
          await db.workspaceInvite.update({
            where: { id: invite.id },
            data: { acceptedAt: new Date() },
          })
        }
      } catch (err) {
        console.error('[Auth] Error auto-accepting invites:', err)
      }
    },
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
        session.user.onboardingCompletedAt = (user as any).onboardingCompletedAt ?? null
      }
      return session
    },
  },
  debug: process.env.NODE_ENV === 'development',
})
