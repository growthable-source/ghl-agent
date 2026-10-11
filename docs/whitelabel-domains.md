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
   move `pending → active`. Pending domains whose DNS never resolves go to `error`
   after 7 days (polling stops; Re-check still works). Active domains are re-verified
   daily and demoted if DNS breaks. Locked workspaces are skipped. Active domains are
   used for all generated links.

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
