# Copilot runtime (not built yet)

Placeholder for the design of a separate Copilot runtime project. Nothing
here is implemented; this file currently records only the constraints that
the white-label domain work (see `docs/whitelabel-domains.md`) places on it.

## White-label domain requirements for whoever builds this

When the runtime exists and main proxies/rewrites traffic to it:

1. **Add the runtime's own hostname to `PRIMARY_HOSTS`** (env var, comma-separated)
   on main and on the runtime. A proxied request arrives carrying the runtime
   project's host; if it isn't primary, middleware treats it as an unknown customer
   host and 404s everything outside the custom-host allowlist.
2. **Extend the cron guard to cover the runtime.** `middleware.ts` currently only
   skips `/api/cron/*` when `IS_WIDGET_RUNTIME === '1'`. Crons in `vercel.json` fire
   on every project that deploys this repo, so the runtime must be covered or each
   cron (including `/api/cron/check-workspace-domains`) runs twice per tick. Do this
   with a flag set on the runtime, not a "runs crons" flag required on main: a missing
   env var on main would silently stop all crons.
3. **Forward the original host from main in a header protected by a shared secret**
   (e.g. `x-original-host` plus an HMAC or secret header the runtime verifies, and
   which main strips from inbound requests). After the proxy, the runtime only sees
   its own host, so `hostMayServeWorkspace` / `resolveWorkspaceIdForHost`
   (`lib/domains/workspace-domain.ts`) cannot enforce "this white-label host may only
   serve its own workspace" without it. Never trust the header without the secret.
