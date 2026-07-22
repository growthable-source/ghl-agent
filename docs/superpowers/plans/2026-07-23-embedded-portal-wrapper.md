# Embedded Portal Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agency-level GHL menu link that asks for a portal URL on first load, stores it per `companyId`, and renders it in an inner iframe on every later load.

**Architecture:** A new client entry page reuses the existing REQUEST_USER_DATA postMessage handshake; a new API route authenticates by decrypting the SSO blob (no session) and reads/writes a new `CompanyPortalBinding` row. Portal login gains a `SameSite=None` embed cookie promoted in middleware (mirror of the dashboard embed-cookie pattern) so Voxility portals can log in inside the nested iframe.

**Tech Stack:** Next.js 16 App Router, Prisma, vitest (unit scope = `lib/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-07-23-embedded-portal-wrapper-design.md`

**Repo caution:** The working tree has unrelated uncommitted voice changes. Stage files explicitly by path in every commit — never `git add -A`.

---

### Task 1: URL validation helper (TDD)

**Files:**
- Create: `lib/portal-embed-url.ts`
- Test: `lib/portal-embed-url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/portal-embed-url.test.ts
import { describe, expect, it } from 'vitest'
import { normalizePortalEmbedUrl } from './portal-embed-url'

describe('normalizePortalEmbedUrl', () => {
  it('accepts a plain https URL', () => {
    expect(normalizePortalEmbedUrl('https://portal.example.com/portal/login?p=acme'))
      .toEqual({ ok: true, url: 'https://portal.example.com/portal/login?p=acme' })
  })

  it('prepends https:// when the scheme is missing', () => {
    expect(normalizePortalEmbedUrl('portal.example.com/portal'))
      .toEqual({ ok: true, url: 'https://portal.example.com/portal' })
  })

  it('trims surrounding whitespace', () => {
    expect(normalizePortalEmbedUrl('  https://portal.example.com  '))
      .toEqual({ ok: true, url: 'https://portal.example.com/' })
  })

  it('rejects http', () => {
    expect(normalizePortalEmbedUrl('http://portal.example.com'))
      .toEqual({ ok: false, reason: 'Portal URL must use https://' })
  })

  it('rejects non-web schemes', () => {
    expect(normalizePortalEmbedUrl('javascript:alert(1)'))
      .toEqual({ ok: false, reason: 'Portal URL must use https://' })
  })

  it('rejects empty input', () => {
    expect(normalizePortalEmbedUrl('   '))
      .toEqual({ ok: false, reason: 'Enter a portal URL' })
  })

  it('rejects garbage that does not parse', () => {
    expect(normalizePortalEmbedUrl('https://'))
      .toEqual({ ok: false, reason: 'That does not look like a valid URL' })
  })

  it('rejects userinfo smuggling', () => {
    expect(normalizePortalEmbedUrl('https://user:pass@evil.com'))
      .toEqual({ ok: false, reason: 'That does not look like a valid URL' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portal-embed-url.test.ts`
Expected: FAIL — cannot resolve `./portal-embed-url`

- [ ] **Step 3: Write the implementation**

```ts
// lib/portal-embed-url.ts
/**
 * Validation/normalization for the "portal URL" an agency saves from the
 * embedded GHL landing page (app/embedded/leadconnector/portal).
 *
 * By design (see the 2026-07-23 spec) this is a RAW URL — we do not
 * check it against the Portal table. The only hard rules:
 *
 *   - https only (the value is rendered as an iframe src inside GHL;
 *     http would be blocked as mixed content anyway),
 *   - must round-trip through the URL parser (kills javascript: etc.),
 *   - no embedded credentials (user:pass@host is never legitimate here
 *     and is a classic phishing shape),
 *   - normalized via URL#toString() so stored values compare stably.
 *
 * A bare "portal.example.com" gets https:// prepended — operators paste
 * hostnames as often as full URLs.
 */

export type PortalEmbedUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string }

export function normalizePortalEmbedUrl(input: string): PortalEmbedUrlResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'Enter a portal URL' }

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Portal URL must use https://' }
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return { ok: false, reason: 'That does not look like a valid URL' }
  }

  return { ok: true, url: parsed.toString() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portal-embed-url.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/portal-embed-url.ts lib/portal-embed-url.test.ts
git commit -m "feat(embed): portal URL normalization helper"
```

---

### Task 2: `CompanyPortalBinding` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (append after the `Portal*` models, ~line 2830)
- Create: `prisma/migrations/20260723000000_company_portal_binding/migration.sql`

- [ ] **Step 1: Add the model to the schema**

```prisma
// CompanyPortalBinding — the portal URL an agency saved from the embedded
// GHL landing page (app/embedded/leadconnector/portal). Keyed by the GHL
// agency companyId because the marketplace app is installed at agency
// level; deliberately a raw URL with no FK to Portal (see the 2026-07-23
// embedded-portal-wrapper spec — approach C).
model CompanyPortalBinding {
  id        String   @id @default(cuid())
  companyId String   @unique
  portalUrl String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Create the migration**

Prefer `npm run db:migrate -- --name company_portal_binding` (needs local DB). If no local DB is reachable, hand-write (this is what the pending voice migration in the tree did):

```sql
-- prisma/migrations/20260723000000_company_portal_binding/migration.sql
CREATE TABLE "CompanyPortalBinding" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "portalUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CompanyPortalBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyPortalBinding_companyId_key" ON "CompanyPortalBinding"("companyId");
```

- [ ] **Step 3: Regenerate the client and typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: generate succeeds; tsc exits 0 (pre-existing errors from the uncommitted voice work are acceptable — compare against `main`'s baseline if unsure)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260723000000_company_portal_binding
git commit -m "feat(embed): CompanyPortalBinding model + migration"
```

---

### Task 3: Binding API route

**Files:**
- Create: `app/api/embedded/portal-binding/route.ts`

- [ ] **Step 1: Write the route**

```ts
// app/api/embedded/portal-binding/route.ts
/**
 * Per-agency portal-URL binding for the embedded GHL landing page.
 *
 * Both methods authenticate with the encrypted SSO blob itself — the
 * caller is an anonymous iframe visitor, not a dashboard user, so there
 * is no NextAuth session to lean on. Decrypting with the marketplace
 * Shared Secret proves the request originated from a real GHL session
 * (same trust model as /api/auth/leadconnector-iframe-handshake).
 *
 *   POST { encryptedData }            → { portalUrl: string | null }
 *   PUT  { encryptedData, portalUrl } → { portalUrl }  (validated + upserted)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decryptSsoBlob } from '@/lib/leadconnector-sso'
import { normalizePortalEmbedUrl } from '@/lib/portal-embed-url'

export const dynamic = 'force-dynamic'

async function resolveCompanyId(req: NextRequest): Promise<
  | { ok: true; companyId: string; body: any }
  | { ok: false; response: NextResponse }
> {
  const sharedSecret = process.env.LEADCONNECTOR_SSO_KEY
  if (!sharedSecret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'LEADCONNECTOR_SSO_KEY is not configured on this deployment.', code: 'SSO_NOT_CONFIGURED' },
        { status: 503 },
      ),
    }
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  }
  if (!body?.encryptedData || typeof body.encryptedData !== 'string') {
    return { ok: false, response: NextResponse.json({ error: 'Missing encryptedData' }, { status: 400 }) }
  }

  try {
    const payload = decryptSsoBlob(body.encryptedData, sharedSecret)
    if (!payload.companyId || typeof payload.companyId !== 'string') {
      return {
        ok: false,
        response: NextResponse.json({ error: 'SSO payload has no companyId', code: 'NO_COMPANY' }, { status: 401 }),
      }
    }
    return { ok: true, companyId: payload.companyId, body }
  } catch (err: any) {
    console.error('[Embedded portal-binding] Decrypt failed:', err?.message)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Could not verify your CRM identity.', code: 'DECRYPT_FAILED' }, { status: 401 }),
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await resolveCompanyId(req)
  if (!auth.ok) return auth.response

  const binding = await db.companyPortalBinding.findUnique({
    where: { companyId: auth.companyId },
    select: { portalUrl: true },
  })
  return NextResponse.json({ portalUrl: binding?.portalUrl ?? null })
}

export async function PUT(req: NextRequest) {
  const auth = await resolveCompanyId(req)
  if (!auth.ok) return auth.response

  const result = normalizePortalEmbedUrl(String(auth.body?.portalUrl ?? ''))
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }

  await db.companyPortalBinding.upsert({
    where: { companyId: auth.companyId },
    create: { companyId: auth.companyId, portalUrl: result.url },
    update: { portalUrl: result.url },
  })
  return NextResponse.json({ portalUrl: result.url })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (baseline unchanged)

- [ ] **Step 3: Commit**

```bash
git add app/api/embedded/portal-binding/route.ts
git commit -m "feat(embed): portal-binding API keyed by GHL companyId"
```

---

### Task 4: Portal embed cookie (dual-cookie + middleware promotion)

**Files:**
- Modify: `lib/embed-session.ts` (append portal cookie constants)
- Modify: `lib/portal-auth.ts` (`COOKIE_NAME` import, `setPortalCookie` embed variant, `clearPortalCookie`)
- Modify: `app/api/portal/login/route.ts` (accept `embedded` flag)
- Modify: `app/portal/login/LoginForm.tsx` (detect frame, send flag)
- Modify: `middleware.ts` (promotion + matcher)

- [ ] **Step 1: Add portal cookie names to `lib/embed-session.ts`** (middleware-safe module, no heavy deps)

```ts
/**
 * Portal analogue of the dashboard pair above. The customer-portal JWT
 * cookie (lib/portal-auth.ts) is SameSite=Lax, which browsers drop in
 * third-party iframe contexts — and the embedded GHL landing page
 * (app/embedded/leadconnector/portal) renders portals in exactly that
 * context. Logging in while framed additionally sets the None variant;
 * middleware promotes it request-side the same way as the dashboard
 * embed cookie.
 */
export const PORTAL_SESSION_COOKIE = 'voxility_portal'
export const PORTAL_EMBED_SESSION_COOKIE = 'voxility_portal_embed'
```

- [ ] **Step 2: Update `lib/portal-auth.ts`**

Replace `const COOKIE_NAME = 'voxility_portal'` with an import, and extend the cookie setters:

```ts
import { PORTAL_SESSION_COOKIE, PORTAL_EMBED_SESSION_COOKIE } from './embed-session'

const COOKIE_NAME = PORTAL_SESSION_COOKIE
```

```ts
export async function setPortalCookie(token: string, opts?: { embedded?: boolean }): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  // Framed logins (the embedded GHL portal wrapper) also get a
  // SameSite=None twin — Lax cookies never travel in third-party
  // iframes. Kept as a separate cookie so regular browser-tab sessions
  // retain Lax's CSRF posture; middleware promotes this one request-side.
  if (opts?.embedded) {
    jar.set(PORTAL_EMBED_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }
}

export async function clearPortalCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
  jar.delete(PORTAL_EMBED_SESSION_COOKIE)
}
```

- [ ] **Step 3: Accept the flag in `app/api/portal/login/route.ts`**

In the success branch, change `await setPortalCookie(token)` to:

```ts
await setPortalCookie(token, { embedded: body?.embedded === true })
```

- [ ] **Step 4: Send the flag from `app/portal/login/LoginForm.tsx`**

Change the fetch body to:

```ts
body: JSON.stringify({
  email,
  password,
  // Inside the embedded GHL wrapper the portal renders in an iframe;
  // the login API then also sets the SameSite=None twin cookie.
  embedded: typeof window !== 'undefined' && window.self !== window.top,
}),
```

- [ ] **Step 5: Promote in `middleware.ts`**

Add to imports:

```ts
import {
  EMBED_SESSION_COOKIE,
  REGULAR_SESSION_COOKIE,
  PORTAL_SESSION_COOKIE,
  PORTAL_EMBED_SESSION_COOKIE,
} from '@/lib/embed-session'
```

Add after the dashboard promotion block (before the /dashboard gate):

```ts
  // Same promotion for the customer portal's cookie pair — /portal
  // pages call getPortalSession(), which is hard-bound to the regular
  // portal cookie name.
  const portal = request.cookies.get(PORTAL_SESSION_COOKIE)
  const portalEmbed = request.cookies.get(PORTAL_EMBED_SESSION_COOKIE)
  if (!portal && portalEmbed) {
    request.cookies.set(PORTAL_SESSION_COOKIE, portalEmbed.value)
  }
```

Add `'/portal/:path*'` to the matcher array (portal pages read the session server-side; the /api/portal routes don't read the session cookie, so they stay out of the matcher).

- [ ] **Step 6: Typecheck + unit tests**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0, all tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/embed-session.ts lib/portal-auth.ts app/api/portal/login/route.ts app/portal/login/LoginForm.tsx middleware.ts
git commit -m "feat(portal): SameSite=None embed cookie so portal login works inside iframes"
```

---

### Task 5: Embedded entry page

**Files:**
- Create: `app/embedded/leadconnector/portal/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
'use client'

/**
 * Agency-level LeadConnector Custom Menu Link entry point that wraps a
 * customer portal.
 *
 * Unlike ../page.tsx (which mints a dashboard session), this page never
 * signs anyone in. It runs the same REQUEST_USER_DATA handshake purely
 * to learn WHICH agency (companyId) is looking at us, asks
 * /api/embedded/portal-binding for that agency's saved portal URL, and:
 *
 *   - no binding yet → shows a one-field form to save one,
 *   - binding exists → renders it full-bleed in an inner iframe, with a
 *     small "Change" affordance floating above it.
 *
 * The encrypted blob is kept in memory for the lifetime of the page —
 * the PUT that saves a new URL re-sends it as its auth proof.
 */

import { useEffect, useRef, useState } from 'react'

type State =
  | { kind: 'awaiting-parent' }
  | { kind: 'loading' }
  | { kind: 'form'; current: string | null; error?: string; saving?: boolean }
  | { kind: 'portal'; url: string }
  | { kind: 'error'; message: string; detail?: string }

const PARENT_TIMEOUT_MS = 5000

export default function EmbeddedPortalWrapper() {
  const [state, setState] = useState<State>({ kind: 'awaiting-parent' })
  const encryptedRef = useRef<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    let resolved = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    async function lookupBinding(encryptedData: string) {
      if (resolved) return
      resolved = true
      if (timeoutId) clearTimeout(timeoutId)
      encryptedRef.current = encryptedData
      setState({ kind: 'loading' })
      try {
        const res = await fetch('/api/embedded/portal-binding', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ encryptedData }),
        })
        const data = await res.json()
        if (!res.ok) {
          setState({ kind: 'error', message: data.error || 'Could not verify your CRM identity.', detail: data.code })
          return
        }
        if (data.portalUrl) setState({ kind: 'portal', url: data.portalUrl })
        else setState({ kind: 'form', current: null })
      } catch (err: any) {
        setState({ kind: 'error', message: 'Network error while loading your portal settings.', detail: err?.message })
      }
    }

    function onMessage(event: MessageEvent) {
      // Same intentionally-loose shape handling as ../page.tsx — the
      // marketplace has versioned these field names over time.
      const data = event.data
      if (!data || typeof data !== 'object') return
      const encrypted: string | undefined =
        data.encryptedData ?? data.encrypted_user_data ?? data.payload
      if (!encrypted || typeof encrypted !== 'string') return
      void lookupBinding(encrypted)
    }

    window.addEventListener('message', onMessage)

    // Origin '*' by design — see ../page.tsx: trust is the server-side
    // decrypt, not the postMessage origin.
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*')
    }

    timeoutId = setTimeout(() => {
      if (resolved) return
      resolved = true
      setState({
        kind: 'error',
        message: 'No response from your CRM. Open this app from a Custom Menu Link inside your CRM.',
      })
    }, PARENT_TIMEOUT_MS)

    return () => {
      window.removeEventListener('message', onMessage)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [])

  async function save() {
    const encryptedData = encryptedRef.current
    if (!encryptedData || state.kind !== 'form') return
    setState({ ...state, saving: true, error: undefined })
    try {
      const res = await fetch('/api/embedded/portal-binding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ encryptedData, portalUrl: draft }),
      })
      const data = await res.json()
      if (!res.ok) {
        setState({ kind: 'form', current: state.current, error: data.error || 'Could not save.', saving: false })
        return
      }
      setState({ kind: 'portal', url: data.portalUrl })
    } catch (err: any) {
      setState({ kind: 'form', current: state.current, error: 'Network error while saving.', saving: false })
    }
  }

  if (state.kind === 'portal') {
    return (
      <div className="fixed inset-0">
        <iframe
          src={state.url}
          title="Portal"
          className="w-full h-full border-0"
          allow="clipboard-write"
        />
        <button
          type="button"
          onClick={() => {
            setDraft(state.url)
            setState({ kind: 'form', current: state.url })
          }}
          className="absolute bottom-3 right-3 text-[11px] px-2.5 py-1.5 rounded-md border transition-opacity opacity-40 hover:opacity-100"
          style={{ background: 'var(--background, #0a0a0a)', borderColor: 'var(--border, #27272a)', color: 'var(--text-secondary, #a1a1aa)' }}
        >
          Change portal URL
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--background, #0a0a0a)', color: 'var(--text-primary, #fafafa)' }}>
      <div className="max-w-sm w-full text-center">
        {(state.kind === 'awaiting-parent' || state.kind === 'loading') && (
          <>
            <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
            <p className="text-sm" style={{ color: 'var(--text-secondary, #a1a1aa)' }}>
              {state.kind === 'awaiting-parent' ? 'Connecting to your CRM…' : 'Loading your portal…'}
            </p>
          </>
        )}

        {state.kind === 'form' && (
          <div className="text-left">
            <h1 className="text-base font-medium mb-1 text-center">Connect your portal</h1>
            <p className="text-xs mb-4 text-center" style={{ color: 'var(--text-tertiary, #71717a)' }}>
              Enter your portal URL. It will load here for everyone in your agency.
            </p>
            <input
              autoFocus
              type="url"
              placeholder="https://portal.yourdomain.com"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void save() }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
            />
            {state.error && <p className="text-xs text-red-400 mt-2">{state.error}</p>}
            <button
              type="button"
              onClick={() => void save()}
              disabled={state.saving || !draft.trim()}
              className="w-full mt-3 px-3 py-2 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {state.saving ? 'Saving…' : 'Save & open portal'}
            </button>
            {state.current && (
              <button
                type="button"
                onClick={() => setState({ kind: 'portal', url: state.current! })}
                className="w-full mt-2 text-xs py-1.5"
                style={{ color: 'var(--text-tertiary, #71717a)' }}
              >
                Cancel
              </button>
            )}
          </div>
        )}

        {state.kind === 'error' && (
          <>
            <p className="text-sm font-medium mb-2">Could not load your portal</p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary, #71717a)' }}>{state.message}</p>
            {state.detail && (
              <p className="text-[10px] font-mono mb-4" style={{ color: 'var(--text-tertiary, #71717a)' }}>{state.detail}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 / no new lint errors

- [ ] **Step 3: Commit**

```bash
git add app/embedded/leadconnector/portal/page.tsx
git commit -m "feat(embed): agency-level portal wrapper entry page"
```

---

### Task 6: Verification + ship

- [ ] **Step 1: Full local verification**

Run: `npm test && npm run lint && npm run build`
Expected: tests pass; lint clean; build succeeds

- [ ] **Step 2: Push**

```bash
git push origin main
```

Production deploy runs `npm run db:migrate:deploy`, which applies the new migration.

- [ ] **Step 3: Post-deploy note**

The marketplace listing needs a new agency-level Custom Menu Link pointing at `/embedded/leadconnector/portal` — a manual marketplace-settings step for the operator, not a code change.
