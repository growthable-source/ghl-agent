# Customer Portal Whitelabel — Design

**Date:** 2026-06-15
**Status:** Approved approach (manual domain ops); building incrementally

## Goal

Let a customer fully whitelabel their support portal: their own domain
(`support.theirbrand.com`), their logo, their accent color. A visitor
to that domain sees the customer's brand on the login screen and
throughout — never "Xovera".

## Decisions (settled)

- **Domain provisioning is manual ops** (Ryan's choice): the customer
  points a CNAME at the app; Ryan adds the domain to the Vercel project
  by hand. No Vercel API integration.
- Branding fields already exist on `Portal` (`logoUrl`, `primaryColor`)
  and the admin PATCH route already accepts them — they only lack UI
  and aren't applied pre-login yet.

## Data model

Add one nullable, unique column:

```prisma
model Portal {
  ...
  customDomain String? @unique   // e.g. "support.acme.com"; null = slug-only
}
```

Hand-run SQL:

```sql
ALTER TABLE "Portal" ADD COLUMN "customDomain" TEXT;
CREATE UNIQUE INDEX "Portal_customDomain_key" ON "Portal"("customDomain");
```

(Nullable unique — Postgres allows many NULLs.)

## Host → portal resolution

New helper `lib/portal-branding.ts`:

```ts
getPortalBranding(host: string | null): Promise<PortalBranding | null>
// looks up Portal by customDomain (normalized: lowercase, strip port);
// returns { id, name, logoUrl, primaryColor } or null.
```

Used by the portal **login page** and **layout** (pre-login state) so a
visitor on a custom domain sees that portal's brand before signing in.
After login, the layout already brands from `session.portalId`; it
keeps doing so.

## Routing (narrow middleware rewrite)

The root `/` is the Xovera marketing site, so a custom-domain visitor
must be routed to the portal. Constraints: middleware runs on Edge and
cannot use Prisma, so it does **no DB lookup** — only a host check.

- Add `'/'` to the middleware matcher.
- In middleware: if the request path is exactly `/` and the `Host` is
  **not** a primary app host, `rewrite('/')` → `/portal`. The portal
  layout then redirects to `/portal/login`, which resolves branding by
  host. All other paths (`/portal/*`, `/api/*`, `/_next/*`) pass
  through unchanged and already work on the custom domain.
- **Primary hosts** are derived from `NEXT_PUBLIC_SITE_URL` +
  `NEXT_PUBLIC_APP_URL` hostnames, plus `localhost` and any
  `*.vercel.app`. Everything else is treated as a portal custom domain.
  This is safe because the dashboard's iframe-embedding whitelabel
  domains never route requests to our server — their iframe `src`
  points at the primary app host — so the only non-primary hosts that
  hit our server are portal custom domains.

## Branding application

- **Login page** (`app/portal/login/page.tsx` + `LoginForm`): resolve
  branding by host; show the portal logo + name instead of the Xovera
  wordmark; apply `primaryColor` to the submit button + focus accents,
  falling back to the existing amber when unset.
- **Layout** (`app/portal/layout.tsx`): already shows the logo
  post-login; extend the pre-login wrapper to brand by host too.

## Admin UI

On the portal detail page (`PortalDetailClient.tsx`), add a
**"Whitelabel & branding"** section:

- Custom domain input (with setup guidance: point a CNAME at
  `cname.vercel-dns.com`; the operator adds the domain in Vercel).
- Logo URL input.
- Primary color input (hex / color picker).
- Saves via the existing `PATCH /api/admin/portals/[id]`, extended to
  accept + normalize `customDomain` (lowercase, strip protocol/path,
  basic hostname validation; `null` clears it; DB unique violation →
  409 "domain already in use").

## Non-goals (v1)

- No automatic Vercel domain provisioning / verification status.
- No per-brand (sub-portal) theming — branding is portal-level.
- No custom email-sender domain for invite emails (separate concern).

## Testing

- `lib/portal-branding.test.ts` for host normalization (pure part:
  lowercase, strip port, reject empty).
- Manual: set a custom domain locally via the admin UI; confirm the
  PATCH normalizes + rejects duplicates; confirm branding renders.
