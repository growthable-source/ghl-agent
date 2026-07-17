'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'
import { Suspense } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const mode = searchParams.get('mode') // 'signup' or null (default = sign in)
  const isSignUp = mode === 'signup'
  // Post-login destination. middleware.ts and several pages (e.g.
  // getting-started, /try/[slug]/claim) already link here with
  // ?callbackUrl=/some/path expecting signIn() to honor it — it was
  // previously ignored (hardcoded to /dashboard). Only accept a
  // same-origin relative path (never an absolute/protocol-relative
  // URL) so this can't become an open redirect; NextAuth's own
  // redirect callback double-checks the origin regardless.
  const rawCallbackUrl = searchParams.get('callbackUrl')
  const callbackUrl = rawCallbackUrl && rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')
    ? rawCallbackUrl
    : '/dashboard'

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--background)', color: 'var(--text-primary)' }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex mb-6">
            <XoveraLogo height={36} />
          </Link>
          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
            {isSignUp ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {isSignUp
              ? 'Get started with AI-powered conversations'
              : 'Sign in to manage your AI agents'}
          </p>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => signIn('google', { callbackUrl })}
            className="w-full flex items-center justify-center gap-3 h-11 rounded-lg border transition-colors text-sm font-medium"
            style={{
              background: 'var(--surface)',
              borderColor: 'var(--border-secondary)',
              color: 'var(--text-primary)',
            }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </div>

        <p className="text-sm text-center mt-6" style={{ color: 'var(--text-tertiary)' }}>
          {isSignUp ? (
            <>Already have an account?{' '}
              <Link href="/login" className="hover:underline" style={{ color: 'var(--text-primary)' }}>Sign in</Link>
            </>
          ) : (
            <>Don&apos;t have an account?{' '}
              <Link href="/start" className="hover:underline" style={{ color: 'var(--text-primary)' }}>Sign up</Link>
            </>
          )}
        </p>

        <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--background)' }}
      >
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}
