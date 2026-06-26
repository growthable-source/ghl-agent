# LeadConnector / GoHighLevel — OAuth Connection Spec

Self-contained instructions for connecting to a LeadConnector
sub-account via OAuth 2.0 and keeping the tokens alive. Covers
**install**, **token exchange**, **storage**, **refresh / renewal**,
and the **disconnect** flow. Nothing else.

---

## 0. Conventions

| Thing | Value |
|---|---|
| Marketplace authorize URL | `https://marketplace.gohighlevel.com/oauth/chooselocation` |
| Token endpoint | `https://services.leadconnectorhq.com/oauth/token` |
| Location-token swap | `https://services.leadconnectorhq.com/oauth/locationToken` |
| Version header on `/oauth/locationToken` | `Version: 2021-07-28` |
| Token endpoint content type | `application/x-www-form-urlencoded` |
| `user_type` on Location installs | `Location` (always, for sub-account installs) |
| Access token lifetime | ~24h |
| Refresh token lifetime | ~1 year, **rotates on every successful refresh** |

---

## 1. Required environment variables

```
OAUTH_CLIENT_ID         # Marketplace → My Apps → Auth → Client Keys
OAUTH_CLIENT_SECRET     # Same place; shown once on creation
OAUTH_VERSION_ID        # Optional; pins your installed app version
APP_URL                 # e.g. https://app.xovera.io — used to build redirect_uri
```

Marketplace listing config (in the GHL developer portal):

- **Redirect URI** (register exactly this — must match the value sent
  in code-for-token AND refresh calls):
  `${APP_URL}/api/auth/callback`

---

## 2. OAuth init — redirect the user to GHL

Build the authorize URL and redirect. Send `state` so you can identify
the calling workspace on the callback.

```ts
// GET /api/auth/crm/connect?workspaceId=<id>&returnTo=<path>
const params = new URLSearchParams({
  response_type: 'code',
  redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
  client_id: process.env.OAUTH_CLIENT_ID!,
  scope: SCOPES,            // see §2.1
  state: encodedState,      // see §2.2
})
if (process.env.OAUTH_VERSION_ID) params.set('version_id', process.env.OAUTH_VERSION_ID)
return Response.redirect(
  `https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`,
)
```

### 2.1 Scopes — request the union of everything you'll ever need

GHL grants only what's in this list AND what's ticked in your
marketplace listing. **If you add a scope in code but forget to tick
it in the listing, the grant silently drops it.** Adding scopes
later requires every existing merchant to re-authorize.

Canonical list we use:

```
contacts.readonly                   contacts.write
conversations.readonly              conversations.write
conversations/message.readonly      conversations/message.write
opportunities.readonly              opportunities.write
calendars.readonly                  calendars.write
calendars/events.readonly           calendars/events.write
locations.readonly
locations/customFields.readonly     locations/customFields.write
locations/tags.readonly             locations/tags.write
users.readonly
workflows.readonly
```

Why each one:

| Scope | Unlocks |
|---|---|
| `contacts.*` | get/create/update/delete contact, search, upsert, DnD, tags |
| `conversations.*` | search/get/create/update/delete threads |
| `conversations/message.*` | read history, send outbound, record inbound, schedule/cancel |
| `opportunities.*` | search/create/update/delete, pipelines, stages, status |
| `calendars.readonly` | list calendars, free-slots, calendar metadata + timezone |
| `calendars.write` | not strictly needed today; kept for symmetry |
| `calendars/events.readonly` | list contact appointments, get appointment notes |
| `calendars/events.write` | **CREATE APPOINTMENTS**, edit, notes — bookings 401 silently without it |
| `locations.readonly` | fetch sub-account name/address/phone/email/website at install time |
| `locations/customFields.*` | read field definitions, write field values on contacts/opps |
| `locations/tags.*` | trigger-tag picker; writes create new tags |
| `users.readonly` | resolve `Contact.assignedTo` → name/email (for `{{user.*}}` merge fields) |
| `workflows.readonly` | populate the workflow picker for add/remove-from-workflow tools |

### 2.2 `state` param

Encodes the calling workspace + optional return path. Two contracts
supported (handle both on the callback for back-compat):

```ts
// New: base64url-encoded JSON
const state = Buffer.from(
  JSON.stringify({ workspaceId, returnTo }),   // returnTo must start with /dashboard/
  'utf8',
).toString('base64url')

// Legacy: bare workspaceId string
const state = workspaceId
```

**Marketplace installs have no `state`** (user clicks Install from
the GHL listing, not from your app) — handle that branch separately
on the callback.

---

## 3. Callback — exchange code for tokens

`GET /api/auth/callback?code=…&state=…` (or `?error=…` on failure).

### 3.1 Code-for-token request

```
POST https://services.leadconnectorhq.com/oauth/token
Content-Type: application/x-www-form-urlencoded
Accept: application/json

client_id=<id>
client_secret=<secret>
grant_type=authorization_code
code=<from query string>
user_type=Location                     ← always "Location" for sub-account installs
redirect_uri=${APP_URL}/api/auth/callback
```

### 3.2 Response shape

```ts
interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  refreshTokenId: string
  expires_in: number          // seconds; typically ~86400 (24h)
  token_type: 'Bearer'
  scope: string               // space-separated, actual granted (not necessarily what you requested)
  userType: 'Location' | 'Company'
  locationId?: string         // sub-account id, present when userType=Location
  companyId: string           // agency id
  userId: string              // installing user
  planId?: string
}
```

### 3.3 What to do with the response

1. **Save the tokens** keyed by `locationId ?? companyId` (see §4).
2. **Log granted vs. requested scope.** Write a `console.warn` when the
   grant is missing scopes you asked for — this is how you debug
   "tags scope missing" reports later (usually means the listing
   dropped the scope from the grant, sometimes means stale state on
   an older Location row).
3. **Redirect** based on `state`:
   - Reconnect (state present) → wherever your app wants the user back.
   - Marketplace install (no state) → provision/find the workspace,
     then redirect into onboarding.

Every failure path should append a correlation id to the error redirect
(`?error=<code>&cid=<8-char hex>`) and log the same id on every line
in the request. Lets a user reporting "install failed with id ABC1234"
be grep-able in logs.

---

## 4. Token storage

Store one row per Location (or one per Company for agency installs).
Minimum schema:

```
locationId        text   PK              # also the GHL location id
companyId         text                   # GHL agency id
userId            text                   # installing GHL user id
userType          text                   # 'Location' | 'Company' — must match what was issued
scope             text                   # the GRANTED scope string, for diagnostics
accessToken       text
refreshToken      text
refreshTokenId    text
expiresAt         timestamptz            # see §4.1
installedAt       timestamptz default now()
```

### 4.1 Expiry margin

When saving, bake in a 5-minute safety margin:

```ts
const expiresAt = new Date(Date.now() + (data.expires_in - 300) * 1000)
```

That way a fresh token is treated as expired ~5 minutes before GHL
actually invalidates it, leaving room for the refresh round-trip
before a real 401 could hit a request.

---

## 5. Token refresh (renewal) — the part most people get wrong

Two bugs the correct implementation guards against:

### 5.1 Thundering herd

When the access token expires, every concurrent request that sees it
expired will call refresh **simultaneously** with the same
`refresh_token` value. GHL rotates `refresh_token` on success — the
first request gets a new pair, every later one using the now-stale
refresh token is rejected, AND GHL may invalidate the whole session.

**Fix: single-flight pattern.** A process-level `Map<key, Promise>`
guarantees at most one in-flight refresh per location. Concurrent
callers await the shared promise.

```ts
const refreshInFlight = new Map<string, Promise<StoredTokens | null>>()

export async function refreshAccessToken(key: string) {
  const existing = refreshInFlight.get(key)
  if (existing) return existing                    // share the in-flight result

  const promise = refreshImpl(key)
  refreshInFlight.set(key, promise)
  try { return await promise }
  finally { refreshInFlight.delete(key) }
}
```

Module state is fine in serverless — within one instance the map
deduplicates; across cold starts the worst case is one duplicate
refresh on the first request after spin-up.

### 5.2 No retry on transient failures

A single 5xx, network hiccup, or brief timeout used to be treated as
"token gone" and forced the user to manually reconnect. Transient
failures should retry; only 4xx from `/oauth/token` means the token
is actually dead.

**Fix: 3 attempts with exponential backoff (400ms, 800ms, 1600ms).**
Short-circuit on `400 / 401 / 403` — those are `invalid_grant`,
permissions revoked, etc. and retrying won't help.

### 5.3 Refresh request

```
POST https://services.leadconnectorhq.com/oauth/token
Content-Type: application/x-www-form-urlencoded
Accept: application/json

client_id=<id>
client_secret=<secret>
grant_type=refresh_token
refresh_token=<current>
user_type=<Location | Company — must match what was issued>
redirect_uri=${APP_URL}/api/auth/callback
```

Response shape is identical to §3.2. The `refresh_token` in the
response is **a new value** — save the new pair, the old refresh
token is now dead.

### 5.4 Full reference implementation

```ts
const REFRESH_TIMEOUT_MS = 15_000
const MAX_REFRESH_ATTEMPTS = 3
const REFRESH_BACKOFF_BASE_MS = 400

async function refreshImpl(key: string): Promise<StoredTokens | null> {
  // Skip placeholder/native rows — they have empty refresh tokens
  // and hitting /oauth/token with empty values is a guaranteed 422.
  if (key.startsWith('placeholder:') || key.startsWith('native:')) return null

  const tokens = await getTokens(key)
  if (!tokens) {
    console.warn(`[TokenStore] refreshAccessToken called for unknown key "${key}"`)
    return null
  }
  if (!tokens.refreshToken || !tokens.userType) {
    console.warn(`[TokenStore] Skipping refresh for "${key}" — empty refresh_token / user_type (reconnect required)`)
    return null
  }

  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt++) {
    const params = new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID!,
      client_secret: process.env.OAUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      user_type: tokens.userType,
      redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)

    try {
      const res = await fetch('https://services.leadconnectorhq.com/oauth/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      // 4xx = re-auth needed. Don't retry.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => '')
        console.error(`[TokenStore] ❌ Refresh rejected for "${key}" HTTP ${res.status}. User must reconnect. ${body.slice(0, 300)}`)
        return null
      }

      // Other non-2xx → retry with backoff.
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        lastError = `HTTP ${res.status}: ${body.slice(0, 200)}`
        console.warn(`[TokenStore] ⚠ Refresh attempt ${attempt}/${MAX_REFRESH_ATTEMPTS} for "${key}" failed: ${lastError}`)
        if (attempt < MAX_REFRESH_ATTEMPTS) {
          await sleep(REFRESH_BACKOFF_BASE_MS * 2 ** (attempt - 1))
          continue
        }
        console.error(`[TokenStore] ❌ Refresh exhausted retries for "${key}". Old tokens preserved.`)
        return null
      }

      // Success — save the new pair (potentially rotated refresh_token).
      const data: OAuthTokenResponse = await res.json()
      const saved = await saveTokens(key, data)
      console.log(`[TokenStore] ✓ Refreshed "${key}"${attempt > 1 ? ` on attempt ${attempt}` : ''}`)
      return saved

    } catch (err: any) {
      clearTimeout(timeoutId)
      const isAbort = err?.name === 'AbortError'
      lastError = isAbort ? `timeout after ${REFRESH_TIMEOUT_MS}ms` : (err?.message ?? 'unknown')
      console.warn(`[TokenStore] ⚠ Refresh attempt ${attempt}/${MAX_REFRESH_ATTEMPTS} for "${key}" threw: ${lastError}`)
      if (attempt < MAX_REFRESH_ATTEMPTS) {
        await sleep(REFRESH_BACKOFF_BASE_MS * 2 ** (attempt - 1))
        continue
      }
      console.error(`[TokenStore] ❌ Refresh exhausted retries for "${key}". Last: ${lastError}`)
      return null
    }
  }
  return null
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
```

### 5.5 `getValidAccessToken` — what every API call should use

```ts
export async function getValidAccessToken(key: string): Promise<string | null> {
  let tokens = await getTokens(key)
  if (!tokens) return null
  if (Date.now() >= tokens.expiresAt) {
    tokens = await refreshAccessToken(key)
  }
  return tokens?.accessToken ?? null
}
```

Returning `null` means "reconnect required" — surface a reconnect
prompt to the user, never a generic 500.

---

## 6. Agency → Location token swap (rare, optional)

For agency-level installs (`userType: 'Company'`) you can mint a
per-sub-account token via:

```
POST https://services.leadconnectorhq.com/oauth/locationToken
Authorization: Bearer <agency access_token>
Version: 2021-07-28
Content-Type: application/json
Accept: application/json

{ "companyId": "...", "locationId": "..." }
```

Response is the same `OAuthTokenResponse` shape. Save it keyed by
`locationId` and treat it like any other Location token from then on.

Most installs come through Location-scoped, so you can skip this
until you actually need to support agency-level marketplace installs.

---

## 7. Disconnect flow

Disconnecting does **not** delete the Location row. It:

1. Blanks `accessToken`, `refreshToken`, `refreshTokenId` on the row.
2. Flips a `crmProvider` flag to `'native'` (or whatever your "not
   connected" state is).

Why not delete: reconnects need to land on the SAME row keyed by GHL
`locationId`. If you delete and re-create, anything else FK'd to the
old row (agents, message logs, routing rules) loses its parent.

Reconnect = run the same OAuth flow again. The callback re-fills
tokens on the existing Location row and resets `crmProvider: 'ghl'`.

---

## 8. Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `"invalid_grant"` from `/oauth/token` on refresh | Concurrent refreshes rotated the token; the second caller used a stale `refresh_token` | Implement single-flight (§5.1) |
| Refresh silently fails and tokens are wiped from DB | Code treated 5xx as permanent failure | Preserve old tokens on transient failures; only wipe on explicit 4xx |
| `400 / 401 / 403` from `/oauth/token` on refresh | Refresh token is genuinely dead; permissions revoked; or user uninstalled app | Surface reconnect — don't retry |
| `"tags scope missing"` after reconnect | Marketplace listing config doesn't have the scope ticked, OR Location row has stale `scope` column from before scopes were added | Log granted-vs-requested scope on every callback; cross-check listing config |
| Token refresh hangs forever | No abort/timeout on the fetch | 15s `AbortController` per attempt (§5.4) |
| `422` on `/oauth/token` with placeholder/native row | The synthetic row has empty `refresh_token` | Skip refresh attempts for keys starting with `placeholder:` / `native:` |
| Reconnect succeeds but app still shows "disconnected" | Disconnect flipped `crmProvider` to `'native'` and the OAuth callback isn't resetting it back to `'ghl'` | Force-set `crmProvider: 'ghl'` on every callback's Location upsert |
| `redirect_uri_mismatch` on token exchange | The `redirect_uri` in your token POST doesn't byte-for-byte match what's registered in the listing | Use the same value (`${APP_URL}/api/auth/callback`) in §2, §3.1, AND §5.3 |

---

## 9. Minimum viable port checklist

- [ ] Env vars set: `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `APP_URL`
- [ ] Marketplace listing has redirect URI = `${APP_URL}/api/auth/callback`
- [ ] Marketplace listing has every scope from §2.1 ticked
- [ ] `GET /api/auth/crm/connect` builds the authorize URL and redirects (§2)
- [ ] `GET /api/auth/callback` exchanges code for tokens (§3) and persists them (§4)
- [ ] Token table has expiry-margin baked into `expiresAt` (§4.1)
- [ ] Refresh implements single-flight (§5.1)
- [ ] Refresh implements 3-attempt exponential backoff with `AbortController` timeout (§5.2, §5.4)
- [ ] Refresh short-circuits on 4xx (§5.4)
- [ ] `getValidAccessToken` checks expiry and refreshes transparently (§5.5)
- [ ] Disconnect blanks tokens + flips a flag instead of deleting the row (§7)

That's it. Implement these and you have a working, durable
LeadConnector connection that won't drop sessions under load.
