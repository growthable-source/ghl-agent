# Partner provisioning API (`/api/v1/partner`)

How a partner product — today, the help centre — turns "this customer
wants an AI chat widget" into a working, trained, embeddable widget in
one call, and then lets the customer style it without leaving the
partner's own admin UI.

## Auth

`Authorization: Bearer vox_live_…`, **org-scope keys only**. The partner
holds one key and provisions on behalf of many customers; a
workspace-scope key is bound to a single tenant and is rejected with
`403 forbidden`.

Org keys have no UI — mint one with:

```bash
node scripts/create-org-api-key.mjs "Help centre provisioning"
```

Writes are capped at 60 calls per 10 minutes per key. The cap is
per-lambda and in-process — a blast-radius limiter on a leaked key, not
a billing control. `ApiRequestLog` is the real audit trail.

## Prerequisites

Provisioning refuses to run — `503` — unless both are true:

1. `prisma/sql/2026-08-07-global-knowledge-collections.sql` and
   `prisma/sql/2026-08-07-partner-installs.sql` have been applied.
2. `CANONICAL_KNOWLEDGE_COLLECTION_KEY` names a collection that exists
   and is flagged `isGlobal`.

This is deliberate. A widget that greets visitors and then can't answer
anything is worse for the customer, and for the upsell, than a failed
call the partner can retry.

## `POST /api/v1/partner/registrations`

Makes a help center KNOWN to Xovera without provisioning anything — no
user, no workspace, no widget, no trial clock, no emails. Call it
fire-and-forget when a customer claims a free help center, so the
account appears on Xovera's admin Help Center page where staff can
provision + unlock it later. Idempotent in every state: re-registering
an already-provisioned install changes nothing and reports its current
status.

Body: `{ externalId, email, businessName, helpCenterUrl?, metadata? }`
(same field semantics as `/installs`). Response:
`{ installId, status }` where status is `registered` on first call, or
whatever the install already is (`ready`, `provisioning`, …).

## `POST /api/v1/partner/installs`

Creates User → Workspace (+ native Location) → Agent (attached to the
shared corpus) → ChatWidget.

**Idempotent on `(provider, externalId)`.** A retry after a network
timeout returns the same account rather than minting a second workspace.
Partially-completed provisions resume from where they stopped.

```jsonc
{
  "externalId": "hc_acct_8812",       // required — the partner's account id
  "email": "owner@acme.com",          // required — becomes the workspace owner
  "businessName": "Acme Ltd",         // required
  "helpCenterUrl": "https://help.acme.com",  // seeds the widget origin allowlist
  "widget": { "primaryColor": "#1a73e8", "title": "Acme Support" },
  "metadata": { "anything": "the partner wants to keep" }
}
```

```jsonc
{
  "data": {
    "installId": "clx…",
    "created": true,                  // false when a retry returned an existing install
    "workspaceId": "clx…",
    "agentId": "clx…",
    "widget": { "id": "clx…", "publicKey": "widget_pub_…" },
    "embedSnippet": "<script src=\"https://…/widget.js\" data-widget-id=\"…\" data-public-key=\"…\" async></script>",
    "builderUrl": "https://…/embedded/widget-builder?t=…",
    "trialEndsAt": "2026-08-21T…"
  }
}
```

`email` is trusted: the user is created passwordless because the partner
already authenticated that person. Same trust model as the demo-bundle
checkout, where the Stripe receipt email plays that role.

`builderUrl` is **single-use** and expires in 10 minutes. Don't cache
it — call the builder-link endpoint for every subsequent open.

## `GET /api/v1/partner/installs/{externalId}`

Status, widget state, usage, and trial state. This is what drives the
partner's own in-product upsell prompt.

```jsonc
{
  "data": {
    "status": "ready",                // provisioning | ready | failed | disabled
    "widget": { "id": "…", "isActive": true, "embedSnippet": "…" },
    "billing": { "plan": "trial", "trialDaysRemaining": 11, "trialExpired": false },
    "usage": { "conversationCount": 42 }
  }
}
```

## `POST /api/v1/partner/installs/{externalId}/builder-link`

Mints a fresh single-use builder URL. Call it each time the customer
clicks "Customise widget".

```jsonc
{ "data": { "builderUrl": "https://…/embedded/widget-builder?t=…", "expiresInSeconds": 600 } }
```

## `DELETE /api/v1/partner/installs/{externalId}`

Sets `widget.isActive = false` and the install to `disabled`, and
invalidates the widget auth cache so the launcher stops loading within
seconds rather than up to 30.

**Never hard-deletes.** The workspace, agent and conversation history
all survive, so re-enabling is a flag flip and support can still see
what happened. Destroying a customer's account because a partner-side
subscription lapsed is not ours to do.

## The embedded builder

`builderUrl` is meant to be iframed inside the partner's admin UI:

```html
<iframe src="{builderUrl}" style="width:100%;height:820px;border:0"></iframe>
```

The page posts its token to `/api/auth/partner-builder-handshake`, which
redeems it (single-use, hashed at rest, 10-minute TTL) and sets a
`SameSite=None` embed session cookie. That cookie is what makes the
builder load authenticated.

Two things the partner must get right:

- **Origins.** Set `PARTNER_FRAME_ANCESTORS` to the partner's admin
  origins. Unlike the marketplace — thousands of unknowable whitelabel
  domains — these are ours and get a real CSP allowlist rather than
  `frame-ancestors *`.
- **Third-party cookies.** The session cookie is `SameSite=None`. A
  browser blocking third-party cookies will show a "session has expired"
  panel instead of the builder. There is no workaround short of opening
  the builder in a top-level tab.

The builder deliberately exposes appearance only — colour, logo, title,
subtitle, welcome message, launcher icon, position, and the live/paused
toggle. Routing, per-location agency controls, install snippets and
deletion stay on the full dashboard, which the customer reaches through
the trial banner's "Choose a plan" link.

## Billing

Provisioned workspaces start on `trial` for `PARTNER_TRIAL_DAYS` days
(default 14). The builder shows a trial banner whose CTA opens Xovera
billing **top-level in a new tab** — Stripe Checkout does not run
reliably in a nested third-party iframe, and the customer should see our
domain before typing card details.

All gates read `getEffectivePlan(workspaceId)`, never `workspace.plan`.
