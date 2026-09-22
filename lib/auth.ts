import NextAuth, { type NextAuthConfig } from 'next-auth'
import { Auth } from '@auth/core'
import Google from 'next-auth/providers/google'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authRequestHref } from '@/lib/auth-host'

/**
 * Operator Google sign-in.
 *
 * Absolute Auth.js URLs follow the request host (`authRequestHref`).
 * The stock `handlers` from `NextAuth()` rewrite the request to
 * AUTH_URL / NEXTAUTH_URL, which pinned both app.xovera.io and
 * app.voxility.ai to one callback. `auth` / `signIn` / `signOut`
 * still come from NextAuth — server session reads pass the cookie
 * through and do not build the OAuth redirect_uri.
 */
const authConfig: NextAuthConfig = {
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
  // Explicit session-token cookie maxAge so the browser writes a
  // persistent cookie instead of a session cookie. Without this, some
  // browsers (Chrome's "Continue where you left off" off, Safari ITP)
  // drop the cookie when the last window closes — which is what
  // surfaced as "Google sign-in doesn't remember me." session.maxAge
  // alone only controls the *server-side* DB session lifetime; the
  // cookie itself needs its own maxAge to survive a browser restart.
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 24 * 90, // 90 days — must match session.maxAge
      },
    },
  },
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID ? [Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Safe to auto-link here: Google ALWAYS delivers a verified email
      // address on the ID token, so "email exists in our DB" from a
      // Google-verified sign-in can only be the same human who owned
      // that email originally — without this flag they'd hit the
      // OAuthAccountNotLinked error and get stuck.
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
    /**
     * Belt-and-suspenders auto-link for OAuth sign-ins.
     *
     * `allowDangerousEmailAccountLinking: true` is set per-provider
     * above and is *supposed* to link an OAuth provider to an existing
     * User-by-email automatically. It works when NextAuth itself
     * created the User during a prior sign-in. It does NOT reliably
     * work when the User was created outside the adapter's flow —
     * which happens in our iframe handshake at
     * /api/auth/leadconnector-iframe-handshake, where we mint a User
     * row directly for someone arriving from the LeadConnector iframe.
     *
     * Without this callback, the second time that user tries to sign
     * in via Google (or GitHub) the OAuth callback throws
     * `OAuthAccountNotLinked` and the user is locked out of the app.
     * Here we detect "User exists by email, no matching Account for
     * this provider" and create the Account row ourselves, then let
     * NextAuth continue. Idempotent — concurrent sign-ins racing on
     * the same email hit the Account table's composite unique and the
     * second one no-ops via the try/catch.
     */
    async signIn({ user, account }) {
      // Only OAuth/OIDC sign-ins need account auto-linking; email,
      // credentials, and webauthn skip this.
      //
      // IMPORTANT: Google is an *OIDC* provider in Auth.js v5
      // (account.type === 'oidc'), NOT 'oauth' — only GitHub is 'oauth'.
      // The original guard checked `!== 'oauth'`, which silently excluded
      // every Google sign-in. growthable.io is a Google Workspace domain,
      // so the entire internal team hit OAuthAccountNotLinked while GitHub
      // users were fine. Cover both provider types.
      if (!account || !user.email) return true
      if (account.type !== 'oauth' && account.type !== 'oidc') return true

      const existing = await db.user.findUnique({
        where: { email: user.email },
        include: {
          accounts: {
            where: { provider: account.provider, providerAccountId: account.providerAccountId },
            select: { id: true },
          },
        },
      })
      if (!existing) return true                  // Fresh signup — normal flow creates User + Account.
      if (existing.accounts.length > 0) return true // Already linked.

      try {
        await db.account.create({
          data: {
            userId: existing.id,
            type: account.type,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            refresh_token: account.refresh_token,
            access_token: account.access_token,
            expires_at: account.expires_at,
            token_type: account.token_type,
            scope: account.scope,
            id_token: account.id_token,
            session_state: account.session_state as string | null,
          },
        })
        // Stamp emailVerified if it was somehow null — NextAuth gates
        // linking on this and the iframe handshake should already set
        // it, but this is the safe place to enforce it.
        if (!existing.emailVerified) {
          await db.user.update({ where: { id: existing.id }, data: { emailVerified: new Date() } })
        }
      } catch (err: any) {
        // Concurrent sign-in or partial link — NextAuth will pick up
        // the existing Account on its next pass. Don't fail the
        // sign-in over a race.
        console.warn('[Auth] Account auto-link race:', err?.message)
      }
      return true
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id
        session.user.onboardingCompletedAt = (user as any).onboardingCompletedAt ?? null
      }
      return session
    },
  },
  debug: process.env.NODE_ENV === 'development',
}

// Initializes secret / basePath / provider defaults on `authConfig`.
// The returned HTTP handlers are not used — see `handlers` below.
const { signIn, signOut, auth } = NextAuth(authConfig)

function handleAuthRequest(req: NextRequest) {
  const href = authRequestHref({
    requestHref: req.nextUrl.href,
    authUrl: process.env.AUTH_URL,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    appUrl: process.env.APP_URL,
  })
  // Same reconstruction next-auth uses in reqWithEnvURL, without
  // swapping the origin for AUTH_URL. Skip the copy when the URL
  // already matches so the POST body is not consumed twice.
  const request = req.url === href ? req : new NextRequest(href, req)
  // next-auth depends on @auth/core 0.41.0, which stays nested because a
  // newer copy is hoisted. The objects are the same AuthConfig; the
  // duplicate type identity is what TypeScript rejects.
  return Auth(request, authConfig as unknown as Parameters<typeof Auth>[1])
}

export const handlers = {
  GET: handleAuthRequest,
  POST: handleAuthRequest,
}

export { signIn, signOut, auth }
