# Customer Portal Brand Restructure — Design

**Date:** 2026-06-15
**Status:** Approved (design); implementation plan pending

## Problem

A customer portal is currently tied to exactly one workspace
(`Portal.workspaceId`, cascade delete). Brands are workspace-scoped
too, so a portal can only ever expose brands from its single parent
workspace. The operator experiences this as "pick a workspace first,"
which makes workspace the portal's *identity axis* — the wrong primary
axis. The desired mental model is **one customer portal serving one or
more brands**, independent of which workspace each brand happens to
live in.

### Why this is safe to change

The customer-facing runtime is already entirely brand-keyed:

- `lib/portal-auth.ts` resolves a session to `brandIds[]` (from the
  user's `PortalUserBrand` rows).
- `app/portal/page.tsx` and `app/portal/conversations/page.tsx` filter
  conversations solely by `brandId IN session.brandIds`. There is **no
  `workspaceId` filter** anywhere in the customer path.

`Portal.workspaceId` does only two things today: (1) it scopes which
brands the admin UI lets you pick, and (2) cascade delete. Portals are
created by platform Super Admins (`requireAdminRole('admin')`), not by
workspace-scoped admins, so there is no authorization model that
depends on the column. The coupling is administrative skin, not
load-bearing runtime logic.

## Goals

- Make a portal's identity "a named set of brands + its users."
- Allow a portal's brands to span workspaces (today they share one;
  the model must not force it).
- Zero change to the customer-facing experience and zero risk to live
  customer sessions.
- A hand-run SQL migration (Ryan applies all production SQL by hand;
  the build pipeline must never run migrations).

## Non-goals

- No "Organization / Customer" entity above Portal (YAGNI).
- No change to how brands relate to workspaces (`Brand.workspaceId`
  stays).
- No change to the customer login / invite-accept / conversations
  flows beyond what falls out of the schema rename.

## Data model

### New: `PortalBrand` (the portal's brand catalog)

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

### Changed models

- **`Portal`**: remove `workspaceId`, the `workspace` relation, and
  `@@index([workspaceId])`. Add `portalBrands PortalBrand[]`.
- **`Workspace`**: remove the `portals Portal[] @relation("WorkspacePortals")`
  back-relation.
- **`Brand`**: unchanged `workspaceId`. Add `portalCatalog PortalBrand[]
  @relation("BrandPortalCatalog")` (distinct from the existing
  `portalAccess PortalUserBrand[] @relation("BrandPortalAccess")`).
- **`PortalUser`, `PortalUserBrand`, `PortalInvite`**: unchanged.

## Migration (hand-run SQL)

Applied by hand in production; the build pipeline stays out of it.

```sql
-- 1. New catalog table
CREATE TABLE "PortalBrand" (
  "id"        TEXT NOT NULL,
  "portalId"  TEXT NOT NULL,
  "brandId"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalBrand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PortalBrand_portalId_brandId_key"
  ON "PortalBrand"("portalId", "brandId");
CREATE INDEX "PortalBrand_brandId_idx" ON "PortalBrand"("brandId");
ALTER TABLE "PortalBrand"
  ADD CONSTRAINT "PortalBrand_portalId_fkey"
  FOREIGN KEY ("portalId") REFERENCES "Portal"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "PortalBrand_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE;

-- 2. Backfill: each portal gets every brand from its current workspace,
--    so no existing user assignment is orphaned.
INSERT INTO "PortalBrand" ("id", "portalId", "brandId", "createdAt")
SELECT gen_random_uuid()::text, p."id", b."id", CURRENT_TIMESTAMP
FROM "Portal" p
JOIN "Brand" b ON b."workspaceId" = p."workspaceId";

-- 3. Drop the workspace coupling
DROP INDEX IF EXISTS "Portal_workspaceId_idx";
ALTER TABLE "Portal" DROP COLUMN "workspaceId";
```

`gen_random_uuid()` is built into Postgres 13+. The PK is plain `TEXT`,
so a UUID value coexists fine with cuid IDs elsewhere.

**Backfill correctness:** every existing `PortalUserBrand.brandId` is a
brand from the portal's old workspace, and step 2 inserts exactly those
brands into the catalog — so every pre-existing assignment remains
valid against the new catalog. No customer loses access.

The matching Prisma migration file is created the normal way for local
dev / checksum bookkeeping; production is applied by hand.

## Code changes

### Admin API

- **`POST /api/admin/portals`**: drop the `workspaceId` requirement.
  Create a portal from `name` + `slug` only. Optionally accept
  `brandIds[]` to seed the catalog (validated to exist).
- **New `PUT /api/admin/portals/[id]/brands`**: replace-set the
  portal's brand catalog from `{ brandIds }`. In one transaction:
  validate the brands exist, set the catalog, and **cascade-remove any
  now-absent brand from every `PortalUserBrand` for that portal and
  from pending `PortalInvite.brandIds`** — so a user never retains
  access to a brand the portal no longer offers.
- **`PUT /api/admin/portals/[id]/users/[userId]/brands`**: source
  `validBrandIds` from `portal.portalBrands` instead of
  `portal.workspace.brands`.
- **`POST /api/admin/portals/[id]/invites`**: source `validBrandIds`
  from `portal.portalBrands`.

### Pure helper (unit-tested)

Extract the "filter incoming brand IDs to an allowed set" logic used by
the invite + per-user-brands + catalog routes into a pure helper in
`lib/` (e.g. `lib/portal-brands.ts`):

```ts
export function filterToAllowedBrands(incoming: string[], allowed: Set<string>): string[]
```

Covered by `lib/portal-brands.test.ts` (dedupe, drop-unknown, empty
cases) — this is the only part that fits vitest's lib-only scope; route
handlers and UI belong to the scenario harness.

### Admin UI

- **`app/admin/portals/new/`** (`page.tsx` + `NewPortalForm.tsx`):
  remove the workspace picker. Create = name + slug, then land on the
  detail page to add brands.
- **`app/admin/portals/[id]/page.tsx`** (server loader): load
  `portal.portalBrands.brand` instead of `portal.workspace.brands`.
  Replace the "Workspace: X" subheader with a brand-centric one
  ("N brands · `slug`"). Replace the "this workspace has no brands"
  warning with a portal-level "add brands to this portal" empty state.
  Also load all brands across workspaces (id, name, slug, workspace
  name) for the catalog picker.
- **`app/admin/portals/[id]/PortalDetailClient.tsx`**: add a **"Brands
  in this portal"** section that adds/removes brands via a picker
  listing brands across all workspaces, grouped by workspace name and
  searchable (today one group; future-proof for many). Invite and
  per-user assignment read from the portal's catalog.
- **`app/admin/portals/page.tsx`** (list): show a brand count per
  portal instead of the workspace name.

## Unchanged

- `lib/portal-auth.ts`, `app/portal/**` (login, invite accept,
  conversations) — all brand-keyed already.
- `PortalUser`, `PortalUserBrand`, `PortalInvite` schemas.

## Edge cases

- **Remove a catalog brand** → cascade out of `PortalUserBrand` and
  pending `PortalInvite.brandIds` (handled in the brands PUT).
- **Brand deleted at workspace level** → FK cascade removes both its
  `PortalBrand` (catalog) and `PortalUserBrand` (assignment) rows.
- **Zero-brand portal** → invite UI shows an "add brands before
  inviting" guard (now portal-level rather than workspace-level).
- **Backfill** → preserves every existing assignment (proof above).

## Testing

- `lib/portal-brands.test.ts` for the pure filter helper.
- Manual / scenario-harness verification for: create portal (no
  workspace step), add/remove catalog brands, invite with catalog
  brands, per-user assignment, and a customer login still seeing only
  assigned brands.
