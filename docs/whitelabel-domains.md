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
   move `pending → active`. Active domains are used for all generated links.

## Security model
- Middleware (`middleware.ts`) 404s every path on a non-primary host except the
  allowlist in `lib/domains/hostname.ts` — dashboard/auth/admin are never
  reachable from a customer-branded host.
- `hostMayServeWorkspace` (`lib/domains/workspace-domain.ts`) ensures a workspace
  host only fronts that workspace's agents/widgets (`validateWidgetRequest`,
  Co-Pilot public session route, `/c/[slug]`).
- Re-locking a workspace stops serving its domain without removing it.

## Ops
Env: `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, optional `DOMAINS_CNAME_TARGET`.
The domain is attached to the project named by `VERCEL_PROJECT_ID`.
