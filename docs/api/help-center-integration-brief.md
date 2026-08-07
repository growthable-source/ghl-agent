# Implementation brief — "Add AI chat widget" in the help centre

**Audience:** whoever is building this inside the help-centre repo. You do
not need access to the Xovera codebase; everything below is the contract.

**Full API reference:** `docs/api/v1-partner-provisioning.md` in the
`ghl-agent` repo.

---

## What you're building

A paid upsell button in the help-centre admin. The customer clicks it
once and ends up with a working AI chat widget answering questions on
their help centre — without ever leaving your app or copying a script
tag.

Three things to build:

1. **"Add AI chat widget"** — one server-side API call, then inject the
   returned snippet into that customer's help-centre pages.
2. **"Customise widget"** — an iframe of Xovera's builder, SSO'd.
3. **A trial/upgrade prompt** — driven by a status endpoint.

Xovera owns billing. The customer upgrades from inside the builder and
pays Xovera directly. You never handle payment.

---

## Credentials

One **org-scope API key** for the whole integration — not one per
customer. Ryan will hand it to you; it looks like `vox_live_…`.

```
XOVERA_API_KEY=vox_live_…
XOVERA_BASE_URL=https://app.xovera.io
```

**Server-side only, always.** This key can create user accounts and
workspaces for arbitrary email addresses. It must never reach a browser,
a client bundle, or a mobile app. Every call below is server-to-server.

Rate limit: 60 writes per 10 minutes per key. Don't call the provisioning
endpoint on page load — only on an explicit user action.

---

## The join key: `externalId`

Whatever your app already calls that customer account. Pass the same
value every time.

Provisioning is idempotent on it: a retry after a timeout returns the
*same* workspace rather than creating a second one, and a half-finished
provision resumes. So it's safe to retry, and safe to call again if you
lose track of state. You do not need to store anything except the
association you already have — you can always re-read the rest.

---

## 1. Provision

```http
POST {XOVERA_BASE_URL}/api/v1/partner/installs
Authorization: Bearer {XOVERA_API_KEY}
Content-Type: application/json

{
  "externalId": "hc_acct_8812",
  "email": "owner@acme.com",
  "businessName": "Acme Ltd",
  "helpCenterUrl": "https://help.acme.com"
}
```

```jsonc
{
  "data": {
    "installId": "clx…",
    "created": true,              // false = this was a retry
    "workspaceId": "clx…",
    "widget": { "id": "clx…", "publicKey": "widget_pub_…" },
    "embedSnippet": "<script src=\"…/widget.js\" data-widget-id=\"…\" data-public-key=\"…\" async></script>",
    "builderUrl": "https://…/embedded/widget-builder?t=…",
    "trialEndsAt": "2026-08-21T…"
  }
}
```

Notes that matter:

- `email` is **trusted**. Xovera creates the account passwordless on your
  say-so, because you already authenticated that person. Send the real
  account owner's address, never a placeholder or a shared inbox.
- `helpCenterUrl` seeds the widget's origin allowlist, so the embed can't
  be lifted onto an unrelated site. Send it.
- `businessName` becomes the workspace name and appears in the agent's
  system prompt.
- Optional `widget: { primaryColor, title, subtitle, welcomeMessage }` if
  you already know their branding — saves them a step in the builder.

**Then inject `embedSnippet` into that customer's help-centre pages
yourself.** You already render those pages; this is the whole reason the
integration beats sending them to Xovera. Don't show them the snippet and
ask them to paste it.

`builderUrl` here is single-use. Use it for the first open, then mint
fresh ones (below).

---

## 2. Open the builder

```http
POST {XOVERA_BASE_URL}/api/v1/partner/installs/{externalId}/builder-link
Authorization: Bearer {XOVERA_API_KEY}
```

```jsonc
{ "data": { "builderUrl": "https://…?t=…", "expiresInSeconds": 600 } }
```

```html
<iframe src="{builderUrl}" style="width:100%;height:820px;border:0"></iframe>
```

**Mint a fresh URL every time the customer opens the builder.** The token
is single-use and expires in 10 minutes. Caching it means the second open
shows "this link is no longer valid" — as does a page refresh, so if your
UI can be refreshed with the panel open, re-mint on mount.

Two environment requirements, both on Xovera's side — send Ryan your
admin origins:

- `PARTNER_FRAME_ANCESTORS` must list the exact origins you'll iframe
  from, or the browser refuses to render the frame.
- The builder's session cookie is `SameSite=None`. A browser blocking
  third-party cookies shows a "session has expired" panel instead. There
  is no workaround short of opening the builder in a top-level tab —
  consider offering that as a fallback link.

The builder exposes appearance only: colour, logo, title, subtitle,
welcome message, launcher icon, position, and a live/paused toggle. Not
routing, not deletion, not install snippets.

---

## 3. Status and the upgrade prompt

```http
GET {XOVERA_BASE_URL}/api/v1/partner/installs/{externalId}
Authorization: Bearer {XOVERA_API_KEY}
```

```jsonc
{
  "data": {
    "status": "ready",                    // provisioning | ready | failed | disabled
    "failureReason": null,
    "widget": { "id": "…", "isActive": true, "embedSnippet": "…" },
    "billing": { "plan": "trial", "trialDaysRemaining": 11, "trialExpired": false },
    "usage": { "conversationCount": 42 }
  }
}
```

Use `billing` to drive your own in-product nudge. The builder already
shows a trial banner with an upgrade CTA, so yours is reinforcement, not
the only path.

`usage.conversationCount` is the number that sells the upgrade — lead
with it.

---

## 4. Cancel

```http
DELETE {XOVERA_BASE_URL}/api/v1/partner/installs/{externalId}
Authorization: Bearer {XOVERA_API_KEY}
```

Deactivates the widget and marks the install `disabled`. It does **not**
delete the workspace, agent, or conversation history — re-enabling is a
flag flip, and support can still see what happened. Call this if the
customer downgrades on your side.

---

## Error handling

| Status | Meaning | What to do |
|---|---|---|
| `401 unauthorized` | Bad or revoked key | Alert; don't retry |
| `403 forbidden` | Key isn't org-scope | Wrong key — alert |
| `422 bad_param` | Missing/invalid field | Fix the payload; don't retry |
| `429 rate_limited` | >60 writes / 10 min | Back off, retry later |
| `503 not_configured` | Corpus env/key missing on Xovera's side | Alert Ryan; retrying won't help |
| `503 migration_pending` | Xovera DB not migrated | Alert Ryan |
| `409 not_ready` | Builder link requested before provisioning finished | Poll `GET` until `status: "ready"` |
| `409 disabled` | Builder link for a disabled install | Re-provision or unhide first |

Error shape is always `{ "error": { "code": "…", "message": "…" } }`.

Provisioning is synchronous and usually completes in a few seconds, but
it does five sequential writes — allow a 60s timeout. If it times out,
**retry the same call**; idempotency handles it.

---

## Don't

- Put the API key anywhere client-side.
- Cache `builderUrl` or reuse it across opens.
- Call `POST /installs` on page load or in a loop — it's an explicit
  user action only.
- Generate your own `externalId` per click; it must be stable per account
  or you'll create duplicate workspaces.
- Promise the customer their trial converts automatically. It doesn't —
  they must pick a plan in Xovera's checkout.

---

## Copy warning

The knowledge corpus every provisioned agent reads is currently the
**public GoHighLevel help centre** (~24k indexed passages). So the widget
answers GoHighLevel questions well and knows **nothing about the
customer's own product or account**.

Write your UI copy to match that. "Answers your customers' GoHighLevel
questions instantly" is true. "An AI trained on your business" is not,
yet — per-customer articles are a planned follow-up.

---

## How to verify you're done

1. Click the button for a test account → a widget appears on that
   account's help centre with no manual copy-paste.
2. Ask it a GoHighLevel question → it answers from the help centre.
3. Ask it something unanswerable → it says so and offers a human, rather
   than inventing an answer.
4. Click the button again for the same account → same `workspaceId`, no
   duplicate.
5. Open the builder, change the primary colour, save → the live widget
   changes colour.
6. Refresh the builder panel → still works (proves you re-mint the token).
7. Open the builder in a browser with third-party cookies blocked →
   verify you show a sensible fallback, not a blank frame.
8. `DELETE` → widget stops loading on the help centre within ~30s.
