# Customer Portal Brand Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple a customer Portal from a single Workspace so one portal can serve any set of brands, via a new `PortalBrand` catalog join table.

**Architecture:** The portal's identity becomes "a named set of brands + its users." A new `PortalBrand` join (Portal↔Brand) holds the catalog; `Portal.workspaceId` is removed. The customer-facing runtime is already brand-keyed (`session.brandIds`), so all changes are in the schema + admin layer. Work lands additively first (helper, table, catalog-reading code) and the workspace column is dropped last, keeping every commit typecheck-green.

**Tech Stack:** Next.js 16, React 19, Prisma 7 (Postgres), Vitest. Path alias `@/*` → repo root. Ryan applies all production SQL by hand; the build pipeline must never run migrations (do NOT create files under `prisma/migrations/`; run `npx prisma generate` only).

**Spec:** `docs/superpowers/specs/2026-06-15-portal-brand-restructure-design.md`

---

### Task 1: Pure brand-filter helper

**Files:**
- Create: `lib/portal-brands.ts`
- Test: `lib/portal-brands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/portal-brands.test.ts
import { describe, it, expect } from 'vitest'
import { filterToAllowedBrands } from './portal-brands'

describe('filterToAllowedBrands', () => {
  it('keeps only IDs present in the allowed set', () => {
    expect(filterToAllowedBrands(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual(['a', 'c'])
  })
  it('dedupes repeated IDs', () => {
    expect(filterToAllowedBrands(['a', 'a', 'b'], new Set(['a', 'b']))).toEqual(['a', 'b'])
  })
  it('returns empty when nothing is allowed', () => {
    expect(filterToAllowedBrands(['a', 'b'], new Set())).toEqual([])
  })
  it('returns empty for empty input', () => {
    expect(filterToAllowedBrands([], new Set(['a']))).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/portal-brands.test.ts`
Expected: FAIL — cannot find module `./portal-brands`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/portal-brands.ts
/**
 * Filter incoming brand IDs down to those allowed (a portal's catalog,
 * or a user's assignable set). Dedupes and drops any ID not in
 * `allowed`. Pure — the single source of truth for "which brand IDs
 * may this write touch", shared by the catalog, invite, and per-user
 * assignment routes.
 */
export function filterToAllowedBrands(incoming: string[], allowed: Set<string>): string[] {
  return Array.from(new Set(incoming.filter(id => allowed.has(id))))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/portal-brands.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/portal-brands.ts lib/portal-brands.test.ts
git commit -m "feat(portal): pure brand-filter helper for catalog/invite/assignment routes"
```

---

### Task 2: Schema — add `PortalBrand` (additive; keep `workspaceId`)

**Files:**
- Modify: `prisma/schema.prisma` (Portal model ~2780, Brand model ~2023)

This task is purely additive so the build stays green. `Portal.workspaceId` is removed in Task 7.

- [ ] **Step 1: Add `portalBrands` relation to the Portal model**

In `prisma/schema.prisma`, inside `model Portal`, add the `portalBrands` line next to the existing relations (leave `workspaceId`, `workspace`, and `@@index([workspaceId])` untouched for now):

```prisma
  users        PortalUser[]
  invites      PortalInvite[]
  portalBrands PortalBrand[]

  @@index([workspaceId])
}
```

- [ ] **Step 2: Add the `PortalBrand` model**

Immediately after the `model Portal { … }` block, add:

```prisma
model PortalBrand {
  id        String   @id @default(cuid())
  portalId  String
  portal    Portal   @relation(fields: [portalId], references: [id], onDelete: Cascade)
  brandId   String
  brand     Brand    @relation("BrandPortalCatalog", fields: [brandId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([portalId, brandId])
  @@index([brandId])
}
```

- [ ] **Step 3: Add the back-relation on Brand**

In `model Brand`, next to the existing `portalAccess PortalUserBrand[] @relation("BrandPortalAccess")` line, add:

```prisma
  portalCatalog PortalBrand[] @relation("BrandPortalCatalog")
```

- [ ] **Step 4: Regenerate the Prisma client (do NOT run migrate)**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (clean — change is additive).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(portal): add PortalBrand catalog model (additive)"
```

- [ ] **Step 7: Hand-run SQL — create + backfill (Ryan applies in prod)**

Provide these statements for Ryan to apply by hand. They create the table and backfill each portal's catalog from its current workspace's brands, so no existing assignment is orphaned. Run BEFORE Task 7's column drop.

```sql
CREATE TABLE "PortalBrand" (
  "id"        TEXT NOT NULL,
  "portalId"  TEXT NOT NULL,
  "brandId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalBrand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortalBrand_portalId_brandId_key" ON "PortalBrand"("portalId", "brandId");
CREATE INDEX "PortalBrand_brandId_idx" ON "PortalBrand"("brandId");
ALTER TABLE "PortalBrand"
  ADD CONSTRAINT "PortalBrand_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "PortalBrand_brandId_fkey"  FOREIGN KEY ("brandId")  REFERENCES "Brand"("id")  ON DELETE CASCADE;

-- Backfill: each portal gets every brand from its current workspace.
INSERT INTO "PortalBrand" ("id", "portalId", "brandId", "createdAt")
SELECT gen_random_uuid()::text, p."id", b."id", CURRENT_TIMESTAMP
FROM "Portal" p
JOIN "Brand" b ON b."workspaceId" = p."workspaceId";
```

---

### Task 3: Catalog management API — `PUT /api/admin/portals/[id]/brands`

**Files:**
- Create: `app/api/admin/portals/[id]/brands/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { filterToAllowedBrands } from '@/lib/portal-brands'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// PUT — replace-set the portal's brand catalog. Removing a brand from
// the catalog also revokes it from every user assignment in this portal
// and trims it from pending invites, so no one retains access to a
// brand the portal no longer offers.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId } = await params

  let body: any = {}
  try { body = await req.json() } catch {}
  const incoming: string[] = Array.isArray(body?.brandIds)
    ? body.brandIds.filter((x: unknown) => typeof x === 'string')
    : []

  const portal = await db.portal.findUnique({ where: { id: portalId }, select: { id: true } })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  // Only real, existing brands may enter the catalog (any workspace).
  const realBrands = incoming.length > 0
    ? await db.brand.findMany({ where: { id: { in: incoming } }, select: { id: true } })
    : []
  const filtered = filterToAllowedBrands(incoming, new Set(realBrands.map(b => b.id)))
  const filteredSet = new Set(filtered)

  // Pending invites referencing now-removed brands get trimmed.
  const pendingInvites = await db.portalInvite.findMany({
    where: { portalId, acceptedAt: null },
    select: { id: true, brandIds: true },
  })
  const inviteUpdates = pendingInvites
    .map(inv => ({ id: inv.id, next: inv.brandIds.filter(b => filteredSet.has(b)), prevLen: inv.brandIds.length }))
    .filter(u => u.next.length !== u.prevLen)

  // Empty catalog → revoke ALL user-brand rows for the portal (avoids
  // Prisma's ambiguous `notIn: []`).
  const revokeWhere = filtered.length > 0
    ? { portalUser: { portalId }, brandId: { notIn: filtered } }
    : { portalUser: { portalId } }

  await db.$transaction([
    db.portalUserBrand.deleteMany({ where: revokeWhere }),
    db.portalBrand.deleteMany({ where: { portalId } }),
    ...(filtered.length > 0
      ? [db.portalBrand.createMany({
          data: filtered.map(brandId => ({ portalId, brandId })),
          skipDuplicates: true,
        })]
      : []),
    ...inviteUpdates.map(u =>
      db.portalInvite.update({ where: { id: u.id }, data: { brandIds: u.next } }),
    ),
  ])

  logAdminActionAfter({ admin: session, action: 'update_portal_brands', target: portalId, meta: { brandIds: filtered } })
  return NextResponse.json({ ok: true, brandIds: filtered })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "app/api/admin/portals/[id]/brands/route.ts"
git commit -m "feat(portal): catalog management route (replace-set, revokes removed brands)"
```

---

### Task 4: Source brand validation from the catalog (invite + per-user routes)

**Files:**
- Modify: `app/api/admin/portals/[id]/invites/route.ts:40-56`
- Modify: `app/api/admin/portals/[id]/users/[userId]/brands/route.ts:24-36`

- [ ] **Step 1: Invite route — read catalog instead of workspace brands**

In `app/api/admin/portals/[id]/invites/route.ts`, replace the portal lookup + validation block (the `db.portal.findUnique` through the `filtered`/`if (filtered.length === 0)` check) with:

```ts
  const portal = await db.portal.findUnique({
    where: { id: portalId },
    select: {
      id: true, name: true, primaryColor: true,
      portalBrands: { select: { brandId: true } },
    },
  })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  // Reject brand IDs outside this portal's catalog.
  const filtered = filterToAllowedBrands(brandIds, new Set(portal.portalBrands.map(pb => pb.brandId)))
  if (filtered.length === 0) {
    return NextResponse.json({ error: 'No valid brand IDs for this portal' }, { status: 400 })
  }
```

Add the import near the top:

```ts
import { filterToAllowedBrands } from '@/lib/portal-brands'
```

- [ ] **Step 2: Per-user brands route — read catalog instead of workspace brands**

In `app/api/admin/portals/[id]/users/[userId]/brands/route.ts`, replace the `db.portalUser.findUnique` lookup and the `validBrandIds`/`filtered` derivation with:

```ts
  const user = await db.portalUser.findUnique({
    where: { id: userId },
    select: {
      id: true, portalId: true, email: true,
      portal: { select: { portalBrands: { select: { brandId: true } } } },
    },
  })
  if (!user || user.portalId !== portalId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const filtered = filterToAllowedBrands(incoming, new Set(user.portal.portalBrands.map(pb => pb.brandId)))
```

Add the import near the top:

```ts
import { filterToAllowedBrands } from '@/lib/portal-brands'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "app/api/admin/portals/[id]/invites/route.ts" "app/api/admin/portals/[id]/users/[userId]/brands/route.ts"
git commit -m "feat(portal): validate brand assignments against the portal catalog"
```

---

### Task 5: Detail page — catalog UI + brand-centric header

**Files:**
- Modify: `app/admin/portals/[id]/page.tsx`
- Modify: `app/admin/portals/[id]/PortalDetailClient.tsx`

- [ ] **Step 1: Replace the detail page loader + header**

Replace the body of `PortalDetailPage` in `app/admin/portals/[id]/page.tsx` (from the `const portal = await db.portal.findUnique(...)` block through the closing `)` of the return) with:

```tsx
  const portal = await db.portal.findUnique({
    where: { id },
    include: {
      portalBrands: { include: { brand: { select: { id: true, name: true, slug: true } } } },
      users: {
        orderBy: { createdAt: 'asc' },
        include: { brandAssignments: { select: { brandId: true } } },
      },
      invites: { where: { acceptedAt: null }, orderBy: { createdAt: 'desc' } },
    },
  })
  if (!portal) notFound()

  // All brands across workspaces, for the catalog picker.
  const allBrands = (await db.brand.findMany({
    orderBy: [{ workspace: { name: 'asc' } }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, workspace: { select: { id: true, name: true } } },
  }))

  const brands = portal.portalBrands.map(pb => pb.brand)
  const users = portal.users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    isActive: u.isActive,
    acceptedAt: u.acceptedAt?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    invitedAt: u.invitedAt.toISOString(),
    brandIds: u.brandAssignments.map(a => a.brandId),
  }))
  const invites = portal.invites.map(i => ({
    id: i.id,
    email: i.email,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    brandIds: i.brandIds,
  }))

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/admin/portals" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Portals
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-white">{portal.name}</h1>
          {!portal.isActive && (
            <span className="inline-block px-2 py-0.5 text-xs rounded bg-zinc-900 text-zinc-500 border border-zinc-800">
              Disabled
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-400 mt-1">
          {brands.length} {brands.length === 1 ? 'brand' : 'brands'}
          <span className="mx-2 text-zinc-700">·</span>
          <span className="font-mono text-xs text-zinc-500">{portal.slug}</span>
        </p>
      </div>

      <PortalDetailClient
        portalId={portal.id}
        brands={brands}
        allBrands={allBrands}
        users={users}
        invites={invites}
      />
    </div>
  )
```

(The old "Workspace: X" header and the workspace-no-brands warning block are removed — the catalog section now owns the empty state.)

- [ ] **Step 2: Add the catalog section + `allBrands` prop to the client**

In `app/admin/portals/[id]/PortalDetailClient.tsx`, add this interface after the existing `interface Brand` line:

```tsx
interface BrandWithWorkspace { id: string; name: string; slug: string; workspace: { id: string; name: string } }
```

Change the component signature + props to accept `allBrands`:

```tsx
export default function PortalDetailClient({
  portalId, brands, allBrands, users, invites,
}: {
  portalId: string
  brands: Brand[]
  allBrands: BrandWithWorkspace[]
  users: PortalUser[]
  invites: PortalInvite[]
}) {
```

Render the catalog section as the first child inside the top-level `<div className="space-y-10">` (immediately before the Invite `<section>`):

```tsx
      <BrandCatalogSection
        portalId={portalId}
        catalog={brands}
        allBrands={allBrands}
        onChanged={() => router.refresh()}
      />
```

Update the invite-form empty-state text (currently "No brands available. Add brands to the workspace first.") to:

```tsx
              <p className="text-xs text-zinc-500">No brands in this portal yet. Add some under “Brands in this portal” above.</p>
```

Then add the `BrandCatalogSection` component at the end of the file:

```tsx
function BrandCatalogSection({
  portalId, catalog, allBrands, onChanged,
}: {
  portalId: string
  catalog: Brand[]
  allBrands: BrandWithWorkspace[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(catalog.map(b => b.id)))
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const q = query.trim().toLowerCase()
  const visible = q
    ? allBrands.filter(b => b.name.toLowerCase().includes(q) || b.workspace.name.toLowerCase().includes(q))
    : allBrands
  const groups = new Map<string, BrandWithWorkspace[]>()
  for (const b of visible) {
    const arr = groups.get(b.workspace.name) ?? []
    arr.push(b)
    groups.set(b.workspace.name, arr)
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}/brands`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandIds: Array.from(selected) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Error ${res.status}`)
        setSaving(false)
        return
      }
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">Brands in this portal</h2>
        {!editing && (
          <button
            onClick={() => { setSelected(new Set(catalog.map(b => b.id))); setEditing(true) }}
            className="text-xs text-zinc-400 hover:text-amber-400"
          >
            Edit brands
          </button>
        )}
      </div>
      <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/30">
        {!editing ? (
          catalog.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No brands yet. Click “Edit brands” to choose the brands this portal exposes — then invite customers.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {catalog.map(b => (
                <span key={b.id} className="px-2 py-0.5 rounded text-xs bg-zinc-900 text-zinc-300 border border-zinc-800">
                  {b.name}
                </span>
              ))}
            </div>
          )
        ) : (
          <>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search brands or workspaces…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none mb-3"
            />
            <div className="max-h-80 overflow-y-auto space-y-4">
              {Array.from(groups.entries()).map(([wsName, list]) => (
                <div key={wsName}>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">{wsName}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map(b => {
                      const on = selected.has(b.id)
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => toggle(b.id)}
                          className={
                            'px-2.5 py-1 rounded text-xs border transition-colors ' +
                            (on
                              ? 'bg-amber-400 text-zinc-950 border-amber-400'
                              : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600')
                          }
                        >
                          {b.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {visible.length === 0 && <p className="text-xs text-zinc-500">No brands match “{query}”.</p>}
            </div>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={save}
                disabled={saving}
                className="px-2.5 py-1 rounded bg-amber-400 text-zinc-950 text-xs font-medium hover:bg-amber-300 disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save ${selected.size} brand${selected.size === 1 ? '' : 's'}`}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-2.5 py-1 rounded border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add "app/admin/portals/[id]/page.tsx" "app/admin/portals/[id]/PortalDetailClient.tsx"
git commit -m "feat(portal): brand-catalog management UI + brand-centric detail header"
```

---

### Task 6: Portals list — brand count instead of workspace

**Files:**
- Modify: `app/admin/portals/page.tsx:17-23` (loader), `:57-78` (Workspace column header + cell)

- [ ] **Step 1: Swap the loader include**

Replace the `db.portal.findMany({...})` call with:

```tsx
  const portals = await db.portal.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { users: true, invites: true, portalBrands: true } },
    },
  })
```

- [ ] **Step 2: Replace the "Workspace" header cell**

Change the header `<th>Workspace</th>` to:

```tsx
                <th className="text-left px-4 py-2 font-medium">Brands</th>
```

- [ ] **Step 3: Replace the workspace body cell**

Replace the `<td>` that renders the workspace link (the block containing `p.workspace.name`) with:

```tsx
                  <td className="px-4 py-3 text-zinc-300">{p._count.portalBrands}</td>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/admin/portals/page.tsx
git commit -m "feat(portal): list shows brand count instead of workspace"
```

---

### Task 7: Drop the workspace coupling (create API + form + schema)

This is the cut. After Tasks 4–6 nothing else references `portal.workspace`, so removing the create-time `workspaceId` and the column together stays green.

**Files:**
- Modify: `app/api/admin/portals/route.ts`
- Replace: `app/admin/portals/new/NewPortalForm.tsx`
- Replace: `app/admin/portals/new/page.tsx`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Confirm no stray workspace references remain**

Run: `grep -rn "portal.workspace\|workspace.portals\|WorkspacePortals\|workspaceId" app/admin/portals app/api/admin/portals`
Expected: only matches inside `app/api/admin/portals/route.ts` and the `new/` form/page (handled in this task). If anything else appears, fix it before continuing.

- [ ] **Step 2: Rewrite the create route**

Replace the entire body of `app/api/admin/portals/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { filterToAllowedBrands } from '@/lib/portal-brands'

export const dynamic = 'force-dynamic'

// POST /api/admin/portals — create a customer portal. A portal is a
// named set of brands + its users; it is no longer scoped to a single
// workspace. Optionally seed the brand catalog with `brandIds`.
export async function POST(req: NextRequest) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const name = String(body?.name ?? '').trim()
  const slug = String(body?.slug ?? '').trim().toLowerCase()
  const brandIds: string[] = Array.isArray(body?.brandIds)
    ? body.brandIds.filter((x: unknown) => typeof x === 'string')
    : []

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase letters, digits, dashes' }, { status: 400 })
  }
  if (slug.length > 60) {
    return NextResponse.json({ error: 'slug too long (max 60 chars)' }, { status: 400 })
  }

  // Slug is globally unique — the portal is reachable by slug from a
  // public URL (e.g. /portal/login?p=acme).
  const existing = await db.portal.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return NextResponse.json({ error: 'slug already taken' }, { status: 409 })

  // Seed the catalog with any provided real brand IDs (optional).
  const realBrands = brandIds.length > 0
    ? await db.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true } })
    : []
  const seedIds = filterToAllowedBrands(brandIds, new Set(realBrands.map(b => b.id)))

  const portal = await db.portal.create({
    data: {
      name,
      slug,
      ...(seedIds.length > 0
        ? { portalBrands: { create: seedIds.map(brandId => ({ brandId })) } }
        : {}),
    },
    select: { id: true, slug: true, name: true },
  })

  logAdminActionAfter({ admin: session, action: 'create_portal', target: portal.id, meta: { slug, name, brandIds: seedIds } })
  return NextResponse.json({ portal })
}
```

- [ ] **Step 3: Replace the new-portal form (drop workspace picker)**

Replace the entire contents of `app/admin/portals/new/NewPortalForm.tsx` with:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function NewPortalForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)

  function onName(v: string) {
    setName(v)
    if (!slugTouched) {
      setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/portals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, slug }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? `Error ${res.status}`)
        setSubmitting(false)
        return
      }
      router.push(`/admin/portals/${body.portal.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Portal name" hint="Shown to customers on the login page and in invite emails.">
        <input
          required
          value={name}
          onChange={e => onName(e.target.value)}
          placeholder="Acme Co. Customer Portal"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
        />
      </Field>
      <Field label="Slug" hint="URL-safe identifier. Lowercase letters, numbers, and dashes.">
        <input
          required
          value={slug}
          onChange={e => { setSlug(e.target.value); setSlugTouched(true) }}
          pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
          placeholder="acme"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 font-mono focus:border-amber-400 outline-none"
        />
      </Field>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !name || !slug}
          className="px-3 py-1.5 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Creating…' : 'Create portal'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-zinc-300 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500 mt-1.5">{hint}</span>}
    </label>
  )
}
```

- [ ] **Step 4: Replace the new-portal page (drop workspace fetch)**

Replace the entire contents of `app/admin/portals/new/page.tsx` with:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAdminOrNull } from '@/lib/admin-auth'
import NewPortalForm from './NewPortalForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'New portal · Xovera Admin',
  robots: { index: false, follow: false },
}

export default async function NewPortalPage() {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/portals" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Portals
        </Link>
        <h1 className="text-2xl font-semibold text-white mt-2">New portal</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Name the portal, then add the brands it exposes and invite customers. A portal can serve brands
          from any workspace.
        </p>
      </div>
      <NewPortalForm />
    </div>
  )
}
```

- [ ] **Step 5: Remove `workspaceId` from the Portal model + the Workspace back-relation**

In `prisma/schema.prisma`, in `model Portal`, delete these three lines:

```prisma
  workspaceId  String
  workspace    Workspace      @relation("WorkspacePortals", fields: [workspaceId], references: [id], onDelete: Cascade)
```

```prisma
  @@index([workspaceId])
```

(Keep `@@index` only if other indexes remain; the Portal model has none besides this one, so the line is removed entirely.) Also remove the now-dangling comment block above `workspaceId` describing the workspace relation.

In `model Workspace`, delete the back-relation line:

```prisma
  portals      Portal[]       @relation("WorkspacePortals")
```

- [ ] **Step 6: Regenerate the client + typecheck**

Run: `npx prisma generate && npx tsc --noEmit`
Expected: client generates; tsc prints no output.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/portals/route.ts "app/admin/portals/new/NewPortalForm.tsx" "app/admin/portals/new/page.tsx" prisma/schema.prisma
git commit -m "feat(portal): drop Portal.workspaceId — portals are brand-scoped, not workspace-scoped"
```

- [ ] **Step 8: Hand-run SQL — drop the column (Ryan applies in prod, AFTER Task 2 SQL + backfill)**

```sql
DROP INDEX IF EXISTS "Portal_workspaceId_idx";
ALTER TABLE "Portal" DROP COLUMN "workspaceId";
```

---

### Task 8: Full verification + push

- [ ] **Step 1: Typecheck, unit tests, lint on touched files**

```bash
npx tsc --noEmit
npm run test
npx eslint lib/portal-brands.ts "app/api/admin/portals/route.ts" "app/api/admin/portals/[id]/brands/route.ts" "app/api/admin/portals/[id]/invites/route.ts" "app/api/admin/portals/[id]/users/[userId]/brands/route.ts" "app/admin/portals/page.tsx" "app/admin/portals/[id]/page.tsx" "app/admin/portals/[id]/PortalDetailClient.tsx" "app/admin/portals/new/page.tsx" "app/admin/portals/new/NewPortalForm.tsx"
```

Expected: tsc clean; vitest all pass (incl. `lib/portal-brands.test.ts`); eslint exit 0 on the listed files.

- [ ] **Step 2: Push**

```bash
git push origin main
```

- [ ] **Step 3: Hand off the two SQL blocks to Ryan**

Remind Ryan to run, in order: (1) Task 2's CREATE + backfill, (2) Task 7's DROP COLUMN — both by hand in production. The deployed code reads `portalBrands` and never writes `workspaceId`, so it is correct whether or not the column has been dropped yet, as long as the CREATE + backfill ran first.

---

## Notes for the implementer

- **Migration safety:** Deploy order is forgiving in one direction only — the CREATE + backfill (Task 2 SQL) MUST run before the new code goes live, or the catalog is empty and existing customers see nothing. The DROP COLUMN (Task 7 SQL) can run any time after, since no deployed code reads `workspaceId`.
- **Customer-facing runtime is untouched.** `lib/portal-auth.ts` and `app/portal/**` filter by `session.brandIds` already; do not modify them.
- **Vitest scope** is `lib/**/*.test.ts` only — route handlers and UI are verified by typecheck + manual/scenario testing, not unit tests.
