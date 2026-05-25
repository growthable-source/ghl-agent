# LeadConnector Marketplace embed setup

Voxility ships as a LeadConnector marketplace app. Operators install it
from inside their CRM; the OAuth flow provisions a Workspace + Location;
the marketplace listing's **Custom Menu Link** loads Voxility as an
iframe inside the CRM UI so users never leave their CRM.

This doc covers what to configure on the marketplace side and what env
vars to set on the Voxility side. The code paths referenced here all
already exist in `main` — there's nothing left to build.

---

## 1. Marketplace app settings (one-time)

In the marketplace builder for the Voxility app:

### Build → Auth → OAuth scopes

Already configured (this is what the existing `/api/auth/callback` flow
consumes). No change.

### Build → Advanced Settings → External Authentication

- **Method**: OAuth v2 (already selected).
- This handles the *install* flow. No change.

### Build → Custom Menu Links

Add these menu items so installed users see Voxility inside their CRM:

| Scope         | Menu label   | URL                                                                                  |
|---------------|--------------|--------------------------------------------------------------------------------------|
| Sub-account   | Voxility     | `https://<your-voxility-domain>/embedded/leadconnector?embedded=leadconnector`       |
| Agency (opt.) | Voxility     | `https://<your-voxility-domain>/embedded/leadconnector?embedded=leadconnector`       |

The marketplace doesn't need to substitute `{{location.id}}` or
`{{company.id}}` in the URL — the iframe asks the parent frame for that
data via `postMessage` and trusts the response by decrypting it with
your Shared Secret. Cleaner than URL-injected IDs (which can be spoofed)
and matches what first-party iframes do.

### Build → Advanced Settings → Shared Secret

Copy the **Shared Secret** (sometimes called "SSO Key") from this
section. You'll set it on the Voxility side as `LEADCONNECTOR_SSO_KEY`
(next section).

---

## 2. Voxility env vars

Set this on the deployment (Vercel project settings, or `.env` for
local):

```
LEADCONNECTOR_SSO_KEY=<paste the Shared Secret from the marketplace settings>
```

That's the only new var for this feature. Use
`printf '%s' "$LEADCONNECTOR_SSO_KEY" | vercel env add LEADCONNECTOR_SSO_KEY production`
rather than `echo` — trailing newlines bake into the env value and
break decryption.

The existing `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` / `APP_URL` vars
still cover the install OAuth flow.

---

## 3. How the iframe load works (debugging reference)

When a user clicks the Voxility menu link inside their CRM:

1. The CRM iframes
   `https://<voxility>/embedded/leadconnector?embedded=leadconnector`.
2. The page posts `{ message: 'REQUEST_USER_DATA' }` to `window.parent`.
3. The CRM replies with `{ encryptedData: '<AES-CBC ciphertext>' }`.
4. The page POSTs that blob to
   `/api/auth/leadconnector-iframe-handshake`.
5. The handler decrypts with `LEADCONNECTOR_SSO_KEY`, finds the matching
   `Workspace` (via `Location.id === payload.activeLocation`), upserts
   a `WorkspaceMember` for the user, mints a NextAuth database
   session, sets `__Secure-authjs.session-token` with `SameSite=None;
   Secure`, and returns `redirectTo`.
6. The page hard-navigates to `redirectTo` (typically
   `/dashboard/<workspaceId>/agents?embedded=leadconnector`). The
   middleware sees a valid session cookie and lets the request through.

### Failure modes seen during testing

| Symptom                                             | Cause                                                                                            | Fix                                                                                                                   |
|-----------------------------------------------------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|
| Iframe blank, console: refused to frame             | `frame-ancestors` doesn't list the whitelabel domain the customer uses                           | Add the customer's domain to `LEADCONNECTOR_PARENT_ORIGINS` in `next.config.ts` and redeploy.                         |
| `SSO_DECRYPT_FAILED`                                | `LEADCONNECTOR_SSO_KEY` doesn't match the Shared Secret, or the env value has a trailing `\n`    | Re-paste using `printf '%s'` and redeploy. Verify by hitting the handshake with a copied payload.                     |
| `NO_LOCATION`                                       | User clicked the menu link before completing OAuth install                                       | Send them through the marketplace install once; the OAuth callback creates the Location, then re-open the menu link.  |
| Session cookie not sticking across pages            | Third-party cookies blocked entirely (Safari ITP, hardened Firefox)                              | Each iframe load re-runs the handshake (idempotent). No persistent fix is possible without same-origin hosting.       |
| Connect Meta / Stripe inside iframe fails           | Those OAuth providers set their own `frame-ancestors 'none'`                                     | Render those CTAs with `target="_blank"` when `useEmbedded().embedded` is true (already in place on most paths).      |

---

## 4. Code map (where to look when something needs to change)

| Concern                         | File                                                                                                          |
|---------------------------------|---------------------------------------------------------------------------------------------------------------|
| Iframe entry point              | [app/embedded/leadconnector/page.tsx](../app/embedded/leadconnector/page.tsx)                                 |
| Handshake / session mint        | [app/api/auth/leadconnector-iframe-handshake/route.ts](../app/api/auth/leadconnector-iframe-handshake/route.ts) |
| SSO blob decryption             | [lib/leadconnector-sso.ts](../lib/leadconnector-sso.ts)                                                       |
| Embedded-mode detection (React) | [lib/embedded-context.tsx](../lib/embedded-context.tsx)                                                       |
| `frame-ancestors` allowlist     | [next.config.ts](../next.config.ts)                                                                           |
| Sidebar chrome adaptations      | [components/dashboard/DashboardSidebar.tsx](../components/dashboard/DashboardSidebar.tsx)                     |

---

## 5. Testing the iframe locally without the marketplace

Two options:

1. **Mock parent**: open `tools/dev-lc-parent.html` (TBD — not built
   yet) in a browser; it iframes your local Voxility and posts a fake
   encrypted payload back. Requires you to encrypt a test payload with
   the dev `LEADCONNECTOR_SSO_KEY` first.
2. **Submission preview**: the marketplace lets you publish to a
   "Testing" channel that's only visible to your dev sub-account. Use
   that — the encryption + postMessage flow is identical to prod and
   it's faster than building a local mock.

Prefer option 2 once the marketplace listing exists. Until then, the
quickest sanity check is `curl -X POST /api/auth/leadconnector-iframe-handshake`
with a test ciphertext you encrypted using OpenSSL CLI with the same
shared secret.
