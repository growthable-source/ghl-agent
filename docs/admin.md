# Voxility super-admin cockpit (`/admin`)

Staff-only backend for cross-workspace visibility. Not shown in any
customer-facing help. This document is for Voxility employees who
support or operate the platform.

## Who should read this

- Ops / support staff running `/admin` to investigate a customer ticket
- Engineers debugging a production incident that needs cross-workspace
  context
- Anyone provisioning or rotating admin accounts

## What the cockpit is for

Six operational needs drive this area. If you're doing any of these,
`/admin` is where you start:

1. **Support ticket context** — "Customer X says their agent isn't
   replying to tag triggers" → find their workspace, drill in, look at
   recent logs.
2. **Incident investigation** — a background error spike → sort recent
   errors cross-workspace, see if it's one account or many.
3. **Billing / revenue troubleshooting** — "Is this workspace on a paid
   plan?" → workspace drill-down shows Stripe IDs, plan, usage, and
   whether they're paused.
4. **Usage analytics** — messages / errors / signups over 30 days for
   board reporting or capacity planning.
5. **Data export** — compliance requests, CSV or JSON-webhook, users /
   workspaces / logs.
6. **Managing internal staff access** — adding / removing super-admins,
   resetting passwords, enforcing 2FA.

## URLs at a glance

- `/admin/setup` — **one-time** first-admin bootstrap (self-disables)
- `/admin/login` — email + password, two-phase if 2FA enrolled
- `/admin` — overview KPIs + 30-day charts + recent errors + latest signups
- `/admin/workspaces` — filterable list of every workspace
- `/admin/workspaces/[id]` — per-workspace drill-down
- `/admin/users` — filterable list of every user
- `/admin/logs` — MessageLog browser across all workspaces
- `/admin/audit` — every admin action (who did what, when, IP, UA)
- `/admin/2fa` — TOTP enrollment / disable
- `/admin/admins` — add / remove / role-change staff (super-only)
- `/admin/settings` — audit-log retention + system config (super-only)

Sidebar nav shows/hides the super-only links based on your role.

## Authentication model

`/admin` does **not** go through the main app's NextAuth pipeline. It's
deliberately separate because:

- The main app uses database-backed sessions (Prisma adapter). Adding
  a Credentials provider to that pipeline would force a switch to JWT
  sessions and log out every OAuth user on deploy. Non-starter.
- Admin access should leave its own audit trail independent of user
  sessions.
- Admin cookie carries a shorter expiry (8h) — tighter than the 30d
  user session.

### How it works

- `/api/admin/login` accepts email + password, bcrypt-compares against
  `SuperAdmin.passwordHash`, signs an HS256 JWT with `jose`, and sets
  it as an HttpOnly `voxility_admin` cookie.
- `lib/admin-auth.ts:getAdminSession()` reads the cookie, verifies
  the JWT, then **cross-checks the DB** — if the admin was marked
  `isActive=false` after the JWT was minted, their session dies
  immediately on next request. Same with role demotions.
- 2FA is an optional second phase. Once enrolled, the first `/login`
  POST issues a "half-session" cookie with `twoFactorVerified=false`;
  the full session only unlocks after a successful
  `/api/admin/2fa/verify` POST.

### Role levels

`viewer` < `admin` < `super`.

| Capability | viewer | admin | super |
|---|---|---|---|
| Browse every admin page | ✓ | ✓ | ✓ |
| CSV / JSON exports | — | ✓ | ✓ |
| Pause / unpause workspaces | — | ✓ | ✓ |
| Create / disable other admins | — | — | ✓ |
| Reset another admin's password | — | — | ✓ |
| Change system settings | — | — | ✓ |

First-setup admin is always auto-promoted to `super` so there's at
least one account with full control.

### Guardrails

These are enforced on the server in `/api/admin/admins/[id]/route.ts`:

- You can't demote yourself from `super`
- You can't deactivate yourself
- You can't delete yourself
- You can't remove the last `super` admin (by demote, deactivate,
  or delete)
- Resetting another admin's password **also clears their 2FA**
  secret. Rationale: the password reset implies the old owner lost
  access; their TOTP could still be valid. Force re-enroll.

## First-admin bootstrap (new deployment only)

Two paths:

### Path A — web UI (easiest)

1. Deploy the app with the schema migrated
   (`SuperAdmin`, `AdminAuditLog`, `SystemSetting` tables exist).
2. Visit `https://your-app/admin/setup` — shown only while zero admins
   exist. Once the first one is created, the page self-disables.
3. Fill in email + name + password. If the env var
   `ADMIN_BOOTSTRAP_SECRET` is set, a "Bootstrap token" field
   appears — paste the value to prove you're intended.
4. Click **Create admin & sign in** → lands on `/admin`.

### Path B — CLI (for locked-out recovery)

Useful when the UI path is blocked (e.g. someone hit `/admin/setup`
first and created the wrong account, so it's sealed).

```bash
# On a machine with access to the prod DB and npm installed
env $(cat .env.local | xargs) node scripts/create-admin.mjs
# Prompts: email → name → password → confirm
```

Re-running with an existing email **resets the password** for that
account. Same tool handles both create and reset.

## Adding a new super-admin (after bootstrap)

Sign in, go to `/admin/admins`, fill in the bottom "Add new admin"
form. The new admin:

- Receives no email (there's no email pipeline — tell them out-of-band)
- Must sign in at `/admin/login` with the password you chose
- Must enroll 2FA themselves at `/admin/2fa` (we strongly recommend it)

## Locked yourself out?

In order of least-to-most invasive:

1. **Forgot password, someone else is super**: they reset it for you
   via `/admin/admins` → Reset password on your row. You log in with
   the new password and re-enroll 2FA.
2. **Forgot 2FA code, someone else is super**: same — they reset your
   password, which also clears 2FA. Log in, re-enroll.
3. **Only-super and fully locked out**: run the CLI
   (`scripts/create-admin.mjs`) against the prod DB to reset your
   password.
4. **Nuclear option**: direct SQL:
   ```sql
   DELETE FROM "SuperAdmin" WHERE email = 'you@voxility.ai';
   -- Then hit /admin/setup again. It'll unlock (zero admins exist).
   ```

## Audit trail

**Every** admin action writes to `AdminAuditLog`. What we capture:

- `login`, `logout`
- `login_password_ok_awaiting_2fa`, `2fa_login_verified`,
  `2fa_verify_failed`, `2fa_enrolled`, `2fa_disabled`,
  `2fa_disable_bad_password`
- `view_overview`, `view_workspaces`, `view_users`, `view_logs`,
  `view_workspace_detail`
- `export_users_csv`, `export_workspaces_csv`, `export_logs_csv`
- `webhook_export`, `webhook_export_failed`, `webhook_export_error`
- `create_admin`, `update_admin`, `delete_admin`
- `pause_workspace`, `unpause_workspace`
- `update_setting`
- `bootstrap_first_admin`

Each row carries:
- `adminEmail` (denormalised — survives admin deletion)
- `target` (contact id / workspace id / "all" / etc.)
- `meta` (JSON — arbitrary extra context)
- `ipAddress` + `userAgent` from request headers
- `createdAt`

Retention is configurable under `/admin/settings` → "Audit log
retention." Default is keep forever. Common production setting is
90 days for SOC / compliance.

The retention cron runs at 03:30 UTC daily via Vercel Cron at
`/api/cron/prune-audit-log`, authenticated by `CRON_SECRET`.

## Data export

Every list page has an **Export CSV** button that downloads the
currently-filtered set. Users page also has **Send to webhook** — a
one-shot POST of the JSON payload to any `https://` URL with the
filter state intact.

Limits:
- CSV: 50,000 rows per export
- Webhook: 10,000 rows per POST, 20s timeout, no retries

Every export writes an audit row with row count + target URL (for
webhook) so compliance reviews can reconstruct what left the building.

## Troubleshooting: "Admin X isn't seeing the admin management page"

Check their role. Viewer and admin tiers don't see `/admin/admins`
in the sidebar at all — it's gated on `role === 'super'`. If they
need it, a super admin promotes them via `/admin/admins`.

## Troubleshooting: "Can't log in after setting up 2FA"

- Confirm their phone's clock is in sync (the TOTP window has ±30s
  tolerance; anything further fails)
- If they're sure the code is current and it's failing, another
  super can reset their password (which clears 2FA) → they log in
  with the new password → re-enroll with a fresh QR

## Troubleshooting: "Can't reach the database at build time"

Vercel sometimes doesn't expose `DATABASE_URL` at build time unless
the env var has the **Build** scope ticked (Settings → Environment
Variables → the var → edit → check Build).

The `scripts/prisma-migrate.mjs` script soft-fails on this — it logs
a warning and exits 0 so the build still ships. That means migrations
didn't run. Either:
- Fix the env var scope and redeploy, or
- Run `npm run db:migrate:deploy` locally against prod

## Phase 3 ideas (not built yet)

Flag for future iteration if any of these become acute pains:

- Per-workspace impersonate-as / shadow session for reproducing
  customer bugs
- Bulk actions (tag N workspaces paused, export N users)
- Configurable audit log alerts (e.g. webhook when any admin
  exports > 1000 rows)
- Read-replica routing for the admin queries so heavy audit
  browsing can't slow customer traffic
- Alert integration (PagerDuty, Sentry) for error-rate spikes
  surfaced on the overview page

## File map

Source / route | Purpose
--- | ---
`app/admin/layout.tsx` | Shared chrome + auth gate for the subtree
`app/admin/page.tsx` | Overview with KPIs + charts + recent errors/signups
`app/admin/workspaces/` | List + per-workspace drill-down
`app/admin/users/page.tsx` | Users list with workspace chips
`app/admin/logs/page.tsx` | MessageLog browser
`app/admin/audit/page.tsx` | AdminAuditLog browser
`app/admin/2fa/` | TOTP enroll/verify/disable UI
`app/admin/admins/` | Super-only admin management
`app/admin/settings/` | System settings (retention)
`app/admin/setup/page.tsx` | One-time first-admin bootstrap
`app/admin/login/page.tsx` | Email + password, 2FA second phase
`app/api/admin/**` | All the server endpoints powering the above
`lib/admin-auth.ts` | Session helpers, role enforcement, audit write
`lib/admin-2fa.ts` | TOTP wrapper (otplib v13 functional API)
`lib/admin-csv.ts` | RFC 4180 CSV encoder, 50k row cap
`lib/admin-timeseries.ts` | Bucket-by-day helper for the charts
`lib/system-settings.ts` | SystemSetting key/value wrapper
`components/admin/Sparkline.tsx` | Inline SVG bar chart
`scripts/create-admin.mjs` | CLI bootstrap / password reset
`prisma/migrations/20260101000000_baseline/` | Schema baseline

## Security checklist for new admin provisioning

Before handing an account to a new team member:

- [ ] Set a strong password (password manager, not memorable)
- [ ] Communicate credentials out-of-band (Bitwarden / 1Password share,
      not Slack DM)
- [ ] Instruct them to enroll 2FA as the first action after first login
- [ ] Role = `admin` unless they specifically need the super tier
      (small team = small blast radius if compromised)
- [ ] Add their account to the shared "super admins" register you
      keep in 1Password / Notion so we know who has access at any
      given time
- [ ] Confirm they see the "SUPER" / "ADMIN" / "VIEWER" chip in the
      sidebar matches their expected role
