# Native Meta integration — setup guide

Connecting Facebook Messenger and Instagram DMs directly, no GoHighLevel
in the middle. The code is in `app/api/meta/**` and `lib/meta-*.ts`;
this document covers the **Meta-side configuration** you need to do
before any of it works.

Plan on ~30 minutes for the initial app creation, plus a 1–4 week wait
on App Review for production traffic against non-test users.

---

## 1. Create the Meta App

1. Go to <https://developers.facebook.com/apps/> and click **Create App**.
2. Use case: **Other** → **Business** → name it whatever (e.g.
   "Voxility Agent"). The name is internal — it's never shown to end
   users in the messaging product.
3. Once created, copy two values from **App settings → Basic**:
   - **App ID** → goes into `META_APP_ID` env var
   - **App Secret** → goes into `META_APP_SECRET` env var (click "Show"
     and re-enter your Facebook password to reveal it)

These two keys live for the lifetime of the app. Don't rotate them
without a coordinated cutover — every connected Page would need to
re-authorize.

---

## 2. Add products

In the app dashboard, on the left rail:

- **Add Product → Facebook Login → Set Up**. Choose "Web" and you can
  skip every step in the quickstart — we don't use the SDK, just the
  OAuth dialog directly.
- **Add Product → Messenger → Set Up**.
- **Add Product → Instagram → Set Up** (only if you want Instagram DMs;
  you said yes, so do this).

You don't need a webhook field selected yet; that's step 4.

---

## 3. Configure Facebook Login redirect URIs

**Facebook Login → Settings**. Add these to the **Valid OAuth Redirect
URIs** list:

- `https://<your-prod-domain>/api/meta/oauth/callback`
- `https://<your-preview-domain>/api/meta/oauth/callback` (if Vercel
  preview deployments need to test the flow)
- `http://localhost:3000/api/meta/oauth/callback` (dev — Meta does
  allow `http` for `localhost` even though it forbids it elsewhere)

Save. The URI on the redirect must match the one our `connect` route
sends in the OAuth request, byte for byte. We pull that base URL from
`NEXT_PUBLIC_APP_URL` if set, otherwise the request's own origin.

---

## 4. Configure the webhook

**Messenger → Webhooks** (and separately **Instagram → Webhooks**).

For each, add a webhook subscription with:

- **Callback URL**: `https://<your-prod-domain>/api/meta/webhook`
- **Verify Token**: any string. Generate something opaque
  (`openssl rand -hex 32`) and use the SAME value for the
  `META_WEBHOOK_VERIFY_TOKEN` env var. Meta sends this back during
  the verification GET; we compare the strings.
- **Subscribe to fields** — for Messenger:
  - `messages` ✓ (the main one)
  - `messaging_postbacks` ✓ (button clicks)
  - `messaging_optins` (optional)
  - `message_echoes` ✗ — leave OFF. We auto-skip echoes in code, but
    not subscribing avoids the round-trip entirely.
- **Subscribe to fields** — for Instagram:
  - `messages` ✓
  - `messaging_postbacks` ✓

Click **Verify and Save**. Meta will hit our `GET /api/meta/webhook`
with the verify token; if `META_WEBHOOK_VERIFY_TOKEN` matches, the
challenge echoes back and the subscription is live. If it fails,
double-check the env var is deployed.

---

## 5. Permissions / App Review

Meta gates messaging APIs behind App Review. The permissions we
request are:

| Permission | Purpose | Review needed? |
|---|---|---|
| `pages_show_list` | List Pages the user manages during OAuth | Yes |
| `pages_messaging` | Receive + send Messenger DMs | Yes |
| `pages_manage_metadata` | Subscribe Pages to webhooks | Yes |
| `instagram_basic` | Read the IG Business Account linked to a Page | Yes |
| `instagram_manage_messages` | Receive + send Instagram DMs | Yes |

Until reviewed, the app works ONLY for Test Users (people listed in
**Roles → Roles**) — admins, developers, and testers. That's enough
to fully exercise the flow during development.

To submit for review:

1. **App Review → Permissions and Features**.
2. Click **Request Advanced Access** for each of the five permissions
   above.
3. Each one needs:
   - A short text justification (1–2 sentences each — explain that
     you're an AI agent platform that handles inbound DMs on behalf
     of businesses).
   - A screencast (~60s) of the flow: connect a Page, send a DM, see
     the agent reply. Loom or QuickTime is fine. Re-use the same
     video for all five permissions.
   - For `instagram_manage_messages`, Meta also wants confirmation
     that the connected IG account is a Business or Creator account
     (not a Personal account).
4. Submit. Review usually takes 1–7 business days. Rejections come
   with a specific note about what's missing — fix and resubmit.

You can iterate on the integration in dev with Test Users while review
is pending. Production launches when Advanced Access is granted.

---

## 6. Environment variables

Add these to Vercel (Production + Preview) and your `.env.local`:

```bash
# From step 1 — App settings → Basic
META_APP_ID="<your app id>"
META_APP_SECRET="<your app secret>"

# From step 4 — anything opaque, must match what's in the webhook
# subscription form
META_WEBHOOK_VERIFY_TOKEN="<openssl rand -hex 32>"

# Used to HMAC-sign the OAuth `state` param so the callback can
# verify it. Generate with: openssl rand -hex 32
META_OAUTH_STATE_SECRET="<openssl rand -hex 32>"

# Public base URL — used to build redirect URIs. On Vercel this
# usually matches your VERCEL_URL but with the custom domain.
NEXT_PUBLIC_APP_URL="https://yourdomain.com"
```

After adding them, **redeploy** so the new values are baked in. Vercel
serverless functions read process.env at cold-start.

---

## 7. Connecting a Page (operator flow)

Once configured, here's what an operator does:

1. Go to **Dashboard → Integrations**.
2. Click **Connect Meta**. (UI is wired to `GET /api/meta/oauth/connect`
   with `?locationId=<id>&workspaceId=<id>`.)
3. Facebook prompts them to log in and pick which Pages to grant
   access to. They should select every Page they want the agent
   to handle.
4. We exchange the OAuth code for a long-lived (~60 day) user token,
   then fetch each Page's individual access token plus its linked
   Instagram Business Account ID (if any).
5. One `Integration` row is saved per Page. The operator returns to
   the dashboard with a success banner.

The operator also needs to **subscribe each Page to the app's webhook**
inside Facebook (Page settings → Apps and Websites → ours). Meta won't
deliver `messages` events to our webhook until the Page is subscribed.
This is a one-time per-Page action.

---

## 8. The 24-hour messaging window

Meta's policy: an outbound message is only allowed without restriction
within **24 hours of the user's last inbound**. After 24h:

- An outbound without a tag is **rejected** with error code 10/200/etc.
- An outbound with `messaging_type=MESSAGE_TAG` and a valid `tag` is
  allowed.

`lib/meta-client.ts → pickMessagingType()` handles this automatically:

- Inside the window: `messaging_type=RESPONSE`, no tag.
- Outside the window: `messaging_type=MESSAGE_TAG`, `tag=HUMAN_AGENT`.
  We default to `HUMAN_AGENT` because it's the broadest legal use for
  a sales / customer-support agent re-engaging a lead.

If Meta rejects messages tagged `HUMAN_AGENT` for your use case (for
example, because the conversation ended in clear "do not contact"
territory), the safe fallback is to skip the outbound and surface
"agent paused" to the operator. The 24h policy isn't enforceable
client-side; we rely on Meta's 4xx response to flag misuse, then
deactivate the offending Integration.

The `MessageLog.errorMessage` column captures the Graph error verbatim
so operators can see exactly what Meta said.

---

## 9. Token expiry + reconnect UX

Page Access Tokens expire ~60 days after the long-lived user token was
minted. There's no silent refresh — when Graph returns 401, the verify
endpoint flips `Integration.isActive = false` and the dashboard shows
a "Reconnect Meta" banner. Operator clicks it, redoes the OAuth flow,
the same `Integration` rows are upserted with fresh tokens.

We deliberately don't auto-rotate. A token expiry usually correlates
with the operator having revoked Page access in Meta's UI, and we'd
rather show that loud than silently fail.

---

## 10. Multi-page

A workspace can connect arbitrarily many Pages. Each Page is its own
`Integration` row with its own access token. The webhook dispatches
inbound by `entry[].id` (the Page ID for Messenger, the IG Business
Account ID for Instagram), so events for different Pages route to
different Integrations independently. Routing rules let you bind a
specific Page to a specific Agent if you want different brands handled
by different prompts.

---

## Troubleshooting checklist

| Symptom | Likely cause |
|---|---|
| Webhook GET returns 403 during Meta's verification | `META_WEBHOOK_VERIFY_TOKEN` env var doesn't match the form |
| Webhook POSTs return 401 in our logs | `META_APP_SECRET` mismatch — must be the same App's secret |
| OAuth callback shows `error=invalid_state` | `META_OAUTH_STATE_SECRET` wasn't deployed to the env that handled the callback (cross-deploy) |
| Connected Page never receives webhooks | Page not subscribed to our app inside Facebook |
| Outbound fails with code 10 / 200 | 24h window closed and tag rejected — check the body returned by Graph |
| Token works in dev but not prod | App is in development mode + the user isn't a Test User |
| Instagram permission denied | Page isn't linked to an IG Business / Creator account |
