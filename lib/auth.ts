import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { db } from '@/lib/db'

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(db) as any,
  // Explicit session settings. NextAuth's silent defaults (30d / 24h
  // regenerate) were catching people out — users who visited rarely
  // would see early sign-outs and think "why doesn't it remember me?".
  // 90 days is a reasonable upper bound for a B2B ops tool; regenerate
  // weekly so a long-lived session doesn't stay tied to a single cookie
  // fingerprint forever.
  session: {
    strategy: 'database',
    maxAge: 60 * 60 * 24 * 90,      // 90 days
    updateAge: 60 * 60 * 24 * 7,    // regenerate after 7 days of activity
  },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID ? [Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Safe to auto-link here: Google ALWAYS delivers a verified email
      // address on the ID token, so "email exists in our DB" from a
      // Google-verified sign-in can only be the same human who owned
      // that email originally. Without this flag, a user who first
      // signed up via GitHub can't later sign in via Google (or vice
      // versa) even though they're the same person — they hit the
      // OAuthAccountNotLinked error and get stuck.
      allowDangerousEmailAccountLinking: true,
    })] : []),
    ...(process.env.GITHUB_CLIENT_ID ? [GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      // GitHub verifies the primary email before returning it via the
      // user:email scope. Same reasoning as Google above — safe to
      // auto-link.
      allowDangerousEmailAccountLinking: true,
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
