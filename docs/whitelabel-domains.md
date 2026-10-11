# Workspace white-label domains

Serves Co-Pilot "no meeting" links (`/copilot/live/<key>`, `copilot.js`) and the
chat/voice widget (`widget.js`, `/widget/*`, `/c/<slug>`) from a customer
subdomain (e.g. `live.acme.com`). One domain per workspace, subdomains only.

## Flow
1. Platform admin: `/admin/workspaces/<id>` → **Unlock white-labelling**
   (commercial deal is outside the product; the flag is `Workspace.whitelabelUnlocked`).
2. Workspace owner/admin: Settings → **Custom domain** → enter `live.acme.com`.
   We attach it to our Vercel project and show the DNS records to create.
3. Customer adds `CNAME live → cname.vercel-dns.com` (plus a TXT only if Vercel asks).
   Cloudflare users: **DNS only** (grey cloud), or Vercel can't issue the cert.
4. `/api/cron/check-workspace-domains` (every 10 min) and the **Re-check** button
   move `pending → active`. If DNS is still missing 7 days after the domain went
   pending (`pendingSince`), it is marked `error` — but it keeps being checked daily
   and goes `active` as soon as DNS resolves. An `active` domain is re-verified daily
   and only demoted after 2 consecutive failed checks (one flaky Vercel response never
   takes a working domain down). Locked workspaces are skipped. Active domains are
   used for all generated links.
5. Removing a domain detaches it from Vercel only if we added it (`addedByUs`). A host
   that was already on the project (adopted) is never detached by a workspace admin.

## Security model
- **Primary hosts** (`lib/domains/primary-hosts.ts`) are every host the app itself
  answers on: `xovera.io`, `voxility.ai` and all their subdomains, `*.vercel.app`,
  localhost, the `NEXT_PUBLIC_*_URL` hosts, plus anything in the `PRIMARY_HOSTS`
  env var (comma-separated). **Any other host is treated as a customer host.**
  If main proxies to another runtime project (e.g. a copilot runtime), put that
  project's own hostname in `PRIMARY_HOSTS`, or its requests will be 404'd.
- Middleware (`middleware.ts`) 404s every path on a non-primary host except the
  allowlist in `lib/domains/hostname.ts` — dashboard/auth/admin are never
  reachable from a customer-branded host. The matcher skips our own hosts at the
  routing layer so normal traffic doesn't pay for an Edge invocation.
- `hostMayServeWorkspace` (`lib/domains/workspace-domain.ts`) blocks a request only
  when its host is *registered* as a workspace domain that is not serving that
  workspace (other workspace, pending, or locked). Primary and unknown hosts are
  never blocked. Applied in `validateWidgetRequest`, the Co-Pilot public session
  route and `/c/[slug]`.
- Re-locking a workspace stops serving its domain without removing it. The host
  cache is 60 s per instance; the lock route clears the local instance only.
- Workspace domains and `Portal.customDomain` share one namespace (checked both ways).

## Ops
Env: `DOMAINS_VERCEL_TOKEN`, `DOMAINS_VERCEL_PROJECT_ID`, `DOMAINS_VERCEL_TEAM_ID`,
optional `DOMAINS_CNAME_TARGET`, `PRIMARY_HOSTS`. Prefixed so they can't collide with
the Vercel CLI's own `VERCEL_*` variables. The domain is attached to the project named
by `DOMAINS_VERCEL_PROJECT_ID` — use the MAIN project (widget.xovera.io skips builds
unless widget files change, so its code goes stale).

## Decision: chat traffic on custom hosts runs on main (branding first)
`public/widget.js` reroutes chat traffic to `widget.xovera.io` only when the loader
is served from `xovera.io` / `voxility.ai`. Loaders served from a white-label host
deliberately stay on that host, so every URL a visitor can see (including the
"live help" tab opened from the chat iframe) shows the customer's domain. The cost:
custom-host chat runs on the main project, without the widget runtime's isolation
from main deploys. Revisit if custom-domain chat volume grows or main deploys start
cutting off live chats. See `docs/copilot-runtime-design.md` for the future runtime.

## Preview / production checklist
1. Confirm which DB the preview's `db:migrate:deploy` points at.
2. Set `DOMAINS_VERCEL_*` on main only. Smoke-test dashboard, Google login and a
   webhook on the vercel.app URL; confirm `PRIMARY_HOSTS` reaches middleware.
3. Widget + a Copilot link via app.xovera.io and widget.xovera.io; `/api/health` on the widget host.
4. On a throwaway subdomain: add → DNS → active. `/dashboard`, `/admin`, `/login`,
   `/api/auth/session` must 404 there; another workspace's widget key 404s; a lock
   takes effect within ~60s.
5. `x.localhost.<test-domain>/admin` must 404 (matcher look-alike regression).
6. Read-only: `SELECT "customDomain" FROM "Portal" WHERE "customDomain" ~ '(xovera\.io|voxility\.ai)$' OR "customDomain" <> lower("customDomain");`
   then list the real Vercel project's domains.
7. Cron logs on both projects (204 on widget, 200 on main).

Note: the matcher in `middleware.ts` must be a static literal, so its host regex cannot
read `PRIMARY_HOSTS`; env-added hosts still run middleware and are classified in code.
`lib/domains/matcher.test.ts` runs the real matcher through Next's own matcher.
