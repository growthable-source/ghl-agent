# Deploy guide: per-agent CRM + LeadConnector marketplace embed

Three commits on `main`:

- [`ed223b2`](https://github.com/growthable-source/ghl-agent/commit/ed223b2) — per-agent CRM picker, marketplace-aware install source, `Workspace.installSource` + `Workspace.primaryCrmProvider` columns
- [`9485f2b`](https://github.com/growthable-source/ghl-agent/commit/9485f2b) — iframe entry point, SSO handshake, embedded-mode chrome
- [`8c862fe`](https://github.com/growthable-source/ghl-agent/commit/8c862fe) — brand-neutral rename (GHL → LeadConnector)

This guide walks through everything needed to roll the code out. Follow
the steps in order — each builds on the previous one.

---

## Step 1 — Apply the SQL migration

The per-agent CRM PR added two columns to `Workspace`
(`installSource`, `primaryCrmProvider`). The code is defensive (every
write is wrapped in try/catch that falls back to the old shape if the
columns are missing) so the app keeps working pre-migration — but the
new behaviour is dormant until you run this:

```sql
-- prisma/migrations-legacy/manual_workspace_install_source.sql

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "installSource" TEXT;

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "primaryCrmProvider" TEXT NOT NULL DEFAULT 'native';

UPDATE "Workspace" w
SET "primaryCrmProvider" = COALESCE(
  (
    SELECT l."crmProvider"
    FROM "Location" l
    WHERE l."workspaceId" = w.id
      AND l."crmProvider" != 'none'
    ORDER BY l."installedAt" DESC
    LIMIT 1
  ),
  'native'
)
WHERE w."primaryCrmProvider" = 'native';
```

**Verify:**

```sql
SELECT id, name, "installSource", "primaryCrmProvider"
FROM "Workspace"
LIMIT 5;
```

Both columns should exist; `primaryCrmProvider` should be set
(`native`/`ghl`/`hubspot`) for every row; `installSource` is `NULL` on
legacy rows (expected — UI treats `NULL` as "direct").

---

## Step 2 — Set `LEADCONNECTOR_SSO_KEY` env var

The iframe handshake decrypts the marketplace's signed user blob using
your app's Shared Secret. Grab the value from the marketplace builder:

**Build → Advanced Settings → Shared Secret** → copy that value.

Then on Vercel (for each environment you ship to):

```bash
printf '%s' "<paste-the-shared-secret>" | vercel env add LEADCONNECTOR_SSO_KEY production
printf '%s' "<paste-the-shared-secret>" | vercel env add LEADCONNECTOR_SSO_KEY preview
printf '%s' "<paste-the-shared-secret>" | vercel env add LEADCONNECTOR_SSO_KEY development
```

**Why `printf` and not `echo`:** `echo "X" | vercel env add` writes a
trailing `\n` into the env value. That extra byte breaks AES decryption
silently — you'd see every iframe load fail with `SSO_DECRYPT_FAILED`
even though the secret "looks right." Burned an hour on this with the
Meta `config_id`; same trap here.

**Verify:**

```bash
vercel env ls | grep LEADCONNECTOR_SSO_KEY
```

Three rows (production, preview, development). No need to print the
value — `vercel env pull .env.local` then `wc -c .env.local | xargs`
should be exactly the expected byte count if you're paranoid about
trailing whitespace.

---

## Step 3 — Deploy

```bash
vercel --prod
```

Or just let the push to `main` you already did trigger the deploy. The
build will succeed regardless of Step 1 — the Prisma client was already
regenerated against the new schema, and the migration's `IF NOT EXISTS`
makes it safe to re-run if Step 1 hasn't happened yet.

**Verify:**

```bash
curl -fsS https://<your-xovera-domain>/api/auth/leadconnector-iframe-handshake \
  -X POST -H 'Content-Type: application/json' -d '{}'
```

Expected response: HTTP 400 with `{"error":"Missing encryptedData"}`.
If you get `503 SSO_NOT_CONFIGURED`, Step 2 didn't land — recheck the
env var.

---

## Step 4 — Configure the marketplace listing

In the LeadConnector marketplace builder for the Xovera app:

### 4a. Custom Menu Links

Add at least one sub-account-scoped menu link:

| Field    | Value                                                                            |
|----------|----------------------------------------------------------------------------------|
| Label    | `Xovera`                                                                       |
| URL      | `https://<your-xovera-domain>/embedded/leadconnector?embedded=leadconnector`   |
| Icon     | (your choice — Xovera wordmark or icon)                                        |
| Scope    | Sub-account                                                                      |

Optionally add a parallel agency-scoped link with the same URL — useful
for whitelabel agencies managing multiple sub-accounts who want a
single entry point.

**Don't** add `{{location.id}}` / `{{company.id}}` substitutions to the
URL. The iframe asks the parent for that data via postMessage and
decrypts it with your Shared Secret — that's the trust boundary, not
URL query params (which can be tampered with).

### 4b. Save the listing

Submit it to the marketplace's "Testing" channel first — only visible
to your dev sub-account, lets you click through end-to-end against the
real encryption + postMessage flow without affecting customers.

---

## Step 5 — Verify the rollout

Run through these in order. Each one isolates a different layer of the
new stack — when something breaks, the failing step points at the layer
to fix.

### 5a. Per-agent CRM picker (Step 1 work)

1. Open `/dashboard/<workspaceId>/agents/<agentId>/integrations` for any
   agent on a workspace with both Native and another CRM connected.
2. The new "CRM" card sits above the MCP tabs. The agent's current CRM
   has the "Active" pill; the workspace's primary CRM has a "Workspace
   default" pill.
3. Click an alternate CRM. Card pill flips, the success banner reads
   "This agent now uses ... for contacts, deals, and messaging."
4. Open another agent in the same workspace and confirm its CRM
   selection is independent (changing agent A didn't change agent B).

### 5b. Integrations page de-emphasis (Step 1 work)

1. Open `/dashboard/<workspaceId>/integrations`.
2. Only the primary CRM card is visible; the other two CRMs are tucked
   behind a "Use a different CRM →" button at the bottom of the CRM
   block.
3. The primary card shows "Recommended for your setup" above its
   header (or "Recommended — you installed from the GHL marketplace"
   if `installSource = 'ghl_marketplace'`).
4. Click "Use a different CRM" — the other two cards appear inline.

### 5c. Marketplace install → installSource attribution (Step 1 work)

1. From your dev sub-account inside LeadConnector, install Xovera
   via the marketplace.
2. After OAuth completes, query the new workspace:
   ```sql
   SELECT id, name, "installSource", "primaryCrmProvider"
   FROM "Workspace" ORDER BY "id" DESC LIMIT 1;
   ```
3. Expect `installSource = 'ghl_marketplace'`,
   `primaryCrmProvider = 'ghl'`.

### 5d. Reconnect auto-primary (Step 1 work)

1. On a test workspace where `primaryCrmProvider = 'native'`, hit
   "Connect" on the LeadConnector card in workspace Integrations.
2. After OAuth completes, query that workspace's
   `primaryCrmProvider` — should now be `'ghl'`.
3. Repeat on a workspace where `primaryCrmProvider = 'hubspot'`
   (manually set via `UPDATE Workspace SET primaryCrmProvider='hubspot' WHERE id=...`).
   After reconnecting LeadConnector, `primaryCrmProvider` should still
   be `'hubspot'` — the auto-flip only triggers from `'native'`, never
   clobbers an explicit choice.

### 5e. Iframe entry (Steps 2-4 work)

1. From your dev sub-account inside LeadConnector, click the Xovera
   menu link you added in Step 4a.
2. Iframe loads. Brief "Connecting to your CRM…" → "Signing you in…"
   → "Loading your workspace…" spinner sequence.
3. You land on `/dashboard/<workspaceId>/agents?embedded=leadconnector`
   inside the iframe with the agents list rendered. No login screen,
   no workspace switcher in the sidebar (logo is non-interactive in
   embedded mode), "Open in new tab ↗" replaces the Sign out button
   at the bottom of the sidebar.
4. Navigate around — visit `/integrations`, an agent's settings, the
   inbox. The session cookie persists across pages.

### 5f. Iframe failure modes

| You see                                  | What's wrong                                                                  | Where to look                                                          |
|------------------------------------------|-------------------------------------------------------------------------------|------------------------------------------------------------------------|
| Iframe blank, `(blocked:origin)` in DevTools | Old deploy still has the whitelisted-origins CSP from before this fix | Redeploy from `main` — `frame-ancestors` is now `*` because whitelabel domains can't be enumerated. Trust gate is the SSO handshake, not the parent origin. |
| `SSO_DECRYPT_FAILED` red banner          | Shared Secret mismatch, or trailing `\n` in env value                         | Re-`printf` Step 2, redeploy                                           |
| `NO_LOCATION` red banner                 | User opened the menu link before completing OAuth install                     | Send them through the marketplace install once, then re-open menu link |
| "No response from your CRM" (5s timeout) | Page loaded outside an iframe, or parent isn't posting the user data         | Confirm you're inside the actual marketplace iframe, not direct URL    |
| Session doesn't persist across iframe pages | Third-party cookies blocked entirely (Safari ITP, hardened Firefox)        | No fix — handshake re-runs each page load (idempotent), accepts perf hit |

---

## Rollback

Code-level rollback: `git revert` the three commits in reverse order
(`8c862fe`, `9485f2b`, `ed223b2`) and redeploy. The SQL columns can
stay — they're additive, nothing depends on them being absent.

Marketplace-level rollback: remove the Custom Menu Link in the
marketplace builder. The OAuth install flow keeps working — users just
lose the in-CRM iframe access.

Env var rollback: `vercel env rm LEADCONNECTOR_SSO_KEY production`.
The handshake endpoint will start returning `503 SSO_NOT_CONFIGURED`;
direct browser access to `/dashboard/...` still works via the normal
NextAuth login.

---

## Code reference

- Per-agent CRM picker: [app/dashboard/[workspaceId]/agents/[agentId]/integrations/page.tsx](../app/dashboard/[workspaceId]/agents/[agentId]/integrations/page.tsx)
- Resolver shared by POST + PATCH: [lib/crm/resolve-location.ts](../lib/crm/resolve-location.ts)
- Install-source attribution + auto-primary: [app/api/auth/callback/route.ts](../app/api/auth/callback/route.ts), [app/api/auth/hubspot/callback/route.ts](../app/api/auth/hubspot/callback/route.ts)
- Iframe entry: [app/embedded/leadconnector/page.tsx](../app/embedded/leadconnector/page.tsx)
- Handshake: [app/api/auth/leadconnector-iframe-handshake/route.ts](../app/api/auth/leadconnector-iframe-handshake/route.ts)
- Embedded mode hook: [lib/embedded-context.tsx](../lib/embedded-context.tsx)
- Sidebar adaptations: [components/dashboard/DashboardSidebar.tsx](../components/dashboard/DashboardSidebar.tsx)
- Full marketplace embed reference: [leadconnector-marketplace-embed.md](leadconnector-marketplace-embed.md)
