# LeadConnector / GoHighLevel Integration Spec

This document is a complete code spec for the LeadConnector (a.k.a.
GoHighLevel / GHL / HighLevel) integration as it works in Voxility's
`ghl-agent` codebase. It's written so another engineer or agent can
read it cold and rebuild a functional integration in another project —
no prior context required.

The integration covers five things:

1. **Marketplace OAuth install** — user clicks Install in the GHL
   marketplace listing → tokens land in your DB, workspace is provisioned.
2. **Reconnect / scope upgrade** — existing workspace re-runs OAuth to
   refresh tokens or pick up new scopes you've added to the listing.
3. **Token storage + auto-refresh** — single-flight, retry-with-backoff,
   permanent vs. transient failure distinction.
4. **REST API client** — wraps every GHL endpoint we use with shared
   auth headers, version pinning, error surface.
5. **Marketplace webhooks** — inbound message, install event, contact
   create, etc.
6. **iframe SSO handshake** — when Voxility is launched from a GHL
   Custom Menu Link, we decrypt the marketplace payload and mint a
   session without a second login.

---

## 0. Conventions

| Thing | Value |
|---|---|
| API base URL | `https://services.leadconnectorhq.com` |
| OAuth authorize URL | `https://marketplace.gohighlevel.com/oauth/chooselocation` |
| OAuth token URL | `https://services.leadconnectorhq.com/oauth/token` |
| Location-token exchange | `https://services.leadconnectorhq.com/oauth/locationToken` |
| API version header | `Version: 2021-07-28` (default), some endpoints want `2021-04-15` (see §4) |
| Auth header | `Authorization: Bearer <accessToken>` |
| Content type | `application/json` (most), `application/x-www-form-urlencoded` (oauth/token) |
| Whitelabel CRM dashboard | `${LEADCONNECTOR_DASHBOARD_BASE_URL or app.voxility.ai}/v2/location/<locationId>` |

**Do not put "GHL" or "HighLevel" in user-facing file/route/env names.**
Use `leadconnector` or generic "CRM" terminology. The string `GhlAdapter`
in our codebase is grandfathered — new code follows the rule.

---

## 1. Required environment variables

```
OAUTH_CLIENT_ID            # from Marketplace → My Apps → Auth → Client Keys
OAUTH_CLIENT_SECRET        # same place; shown once on creation
OAUTH_VERSION_ID           # optional; pins your installed app version

APP_URL                    # e.g. https://app.voxility.ai — used to build redirect_uri

# Webhook signing (optional but recommended)
WEBHOOK_SECRET             # if your marketplace listing signs webhooks

# iframe SSO (Custom Menu Link in marketplace)
LEADCONNECTOR_SSO_KEY      # the "Shared Secret" from the marketplace app settings

# Optional whitelabel dashboard host
LEADCONNECTOR_DASHBOARD_BASE_URL   # defaults to https://app.voxility.ai
```

Marketplace listing config (in the GHL developer portal):

- **Redirect URI**: `${APP_URL}/api/auth/callback` — register this exactly.
- **Webhook URL**: `${APP_URL}/api/webhooks/events` — subscribe to:
  `InboundMessage`, `OutboundMessage`, `INSTALL`, `ContactCreate`,
  `ContactTagUpdate`, `OpportunityStageUpdate`. Subscribe to anything
  else your product needs to react to.
- **Custom Menu Link** (for iframe embedding): point at
  `${APP_URL}/embedded/leadconnector` — unique URL only ever hit
  inside an iframe.

---

## 2. OAuth install flow

### 2.1 Initiate (`GET /api/auth/crm/connect?workspaceId=<id>&returnTo=<path>`)

Build the marketplace authorize URL and redirect the user.

```ts
// app/api/auth/crm/connect/route.ts
const params = new URLSearchParams({
  response_type: 'code',
  redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
  client_id: process.env.OAUTH_CLIENT_ID!,
  scope: SCOPES,            // see §2.2
  state: encodedState,      // see §2.3
})
if (process.env.OAUTH_VERSION_ID) params.set('version_id', process.env.OAUTH_VERSION_ID)
return Response.redirect(`https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`)
```

### 2.2 Scopes (canonical list)

Each endpoint requires its matching scope. **This is the list we
request — match it 1:1 in your marketplace listing config or the
grant will silently drop the missing scopes.**

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

| Scope | What unlocks |
|---|---|
| `contacts.*` | get/create/update/delete contact, search, upsert, DnD |
| `conversations.*` | search threads, create thread, mark read/starred |
| `conversations/message.*` | read message history, send outbound, record inbound, schedule, cancel |
| `opportunities.*` | search/get/create/update/delete opp, pipelines, stages, status |
| `calendars.readonly` | list calendars, free-slots, calendar metadata + timezone |
| `calendars.write` | not strictly needed for current features, kept for symmetry |
| `calendars/events.readonly` | list contact appointments, get appointment notes |
| `calendars/events.write` | **CREATE APPOINTMENTS**, edit, create/edit notes — bookings 401 silently without this |
| `locations.readonly` | install-snapshot fetch (sub-account name, address, phone, etc.) |
| `locations/customFields.*` | read/list custom field definitions, write custom field values on contacts/opps |
| `locations/tags.*` | trigger-tag picker reads from here; writes create new tags |
| `users.readonly` | resolve `assignedTo` userId → name/email/phone (for `{{user.*}}` merge fields) |
| `workflows.readonly` | populate the workflow picker for add_to/remove_from_workflow tools |

### 2.3 State param

Encodes the calling workspace + an optional return path. Two contracts
supported on the callback for back-compat:

```ts
// New (recommended): base64url-encoded JSON
const state = Buffer.from(
  JSON.stringify({ workspaceId, returnTo }),  // returnTo must start with /dashboard/
  'utf8',
).toString('base64url')

// Legacy: bare workspaceId string
const state = workspaceId
```

**Marketplace installs have no state** (user clicks Install from the
listing, not from your app) — handle that branch separately in the
callback (see §2.5).

### 2.4 Code-for-token exchange

`POST https://services.leadconnectorhq.com/oauth/token` with `Content-Type:
application/x-www-form-urlencoded`:

```
client_id=<id>
client_secret=<secret>
grant_type=authorization_code
code=<code from query string>
user_type=Location               ← always "Location" for sub-account installs
redirect_uri=${APP_URL}/api/auth/callback
```

Response body:

```ts
interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  refreshTokenId: string
  expires_in: number          // seconds; ~24h for fresh tokens
  token_type: 'Bearer'
  scope: string               // space-separated, actual granted
  userType: 'Location' | 'Company'
  locationId?: string         // sub-account id (present when userType=Location)
  companyId: string           // agency id
  userId: string              // installing user
  planId?: string
}
```

### 2.5 Callback handler (`GET /api/auth/callback?code=…&state=…`)

The callback at `app/api/auth/callback/route.ts` orchestrates seven
steps. Each step is independent — pulling them into named helpers in
`lib/oauth-install.ts` keeps the route from becoming a 300-line
try/catch chain.

1. **Exchange code for tokens** (§2.4).
2. **Save tokens** to your token store keyed by `locationId ?? companyId`.
3. **Log granted vs requested scope** — write a `console.warn` when the
   grant is missing scopes you asked for. This is how you debug "tags
   scope missing" reports later (usually means your marketplace listing
   dropped the scope from the grant; sometimes means stale state on an
   older row).
4. **Fetch install snapshot** (§3) — `/locations/{id}`, `/companies/{id}`,
   `/users/{id}` with the fresh token, parallelised, each individually
   wrapped so a 403 on Companies doesn't sink the others.
5. **Upsert the Location row** with `crmProvider: 'ghl'` (force, even
   on reconnect — disconnect flips it to `'native'` and we need to
   reset it).
6. **Cascade agent ownership** — `Agent.workspaceId := <current workspaceId>`
   for every agent on this Location. Without this, agents tagged to a
   previous workspace still fire on inbounds after the Location is
   moved (the "ghost agent" bug).
7. **Branch + redirect**:

   - **Reconnect** (state present): write `MarketplaceInstall` row (each
     reconnect is a re-engagement event, worth tracking), flip the
     workspace's `primaryCrmProvider` from `'native'` to `'ghl'` if
     applicable, redirect to `returnTo || /dashboard/<wsId>/integrations`.
   - **Marketplace install** (no state, Location previously unknown):
     create a Workspace named from the sub-account snapshot, slug from
     the locationId, `installSource: 'ghl_marketplace'`,
     `primaryCrmProvider: 'ghl'`. Then cascade + write install row.
     New workspaces with 0 agents → `/dashboard/<wsId>/onboarding`,
     otherwise `/dashboard/<wsId>`.
   - **Marketplace install on a known Location**: reuse the existing
     workspaceId; same redirect logic as marketplace install.

Every failure path appends `?error=<code>&cid=<correlationId>` so a
user reporting "install failed with id ABC1234" is greppable in logs.

---

## 3. Install snapshot (`lib/leadconnector-install-fetcher.ts`)

Three parallel GETs to capture sub-account identity at install time
(business name, address, phone, agency, installing user). Done once,
persisted to `MarketplaceInstall`, used to render workspace name,
the integrations page identity strip, and the per-agent connection line.

```ts
async function fetchInstallSnapshot(opts: {
  accessToken: string
  locationId?: string | null
  companyId?: string | null
  userId?: string | null
}): Promise<InstallSnapshot> {
  const headers = {
    Authorization: `Bearer ${opts.accessToken}`,
    Version: '2021-07-28',
    Accept: 'application/json',
  }
  // Each call wrapped so a 403 on /companies/* (typical for non-agency
  // installs without companies.readonly) doesn't sink the others.
  const [locationRes, companyRes, userRes] = await Promise.all([
    opts.locationId  ? ghlGet(`/locations/${opts.locationId}`, headers) : null,
    opts.companyId   ? ghlGet(`/companies/${opts.companyId}`,  headers) : null,
    opts.userId      ? ghlGet(`/users/${opts.userId}`,         headers) : null,
  ])
  // Defensive optional-chains — field casing has drifted historically.
  return {
    location: locationRes?.location ? {
      id, name: name ?? businessName,
      email, phone, website,
      address: address ?? address1,
      city, state: state ?? province, country, timezone,
    } : null,
    company: companyRes?.company ? {
      id, name: name ?? companyName ?? businessName,
      email, phone, website: website ?? domain,
    } : null,
    user: userRes?.user ? {
      id, name: name ?? `${firstName} ${lastName}`,
      email, phone, role: role ?? type,
    } : null,
    raw: { location: locationRes, company: companyRes, user: userRes },
  }
}
```

Persisted to `MarketplaceInstall` (workspace-scoped, decoupled from
`Location` so it survives disconnect — every reconnect writes a new
row, treated as a re-engagement signal). See `lib/oauth-install.ts`
→ `writeMarketplaceInstall`.

---

## 4. Token storage + auto-refresh (`lib/token-store.ts`)

Two historic bugs the implementation guards against:

### 4.1 Thundering herd

When an access token expires, every concurrent request that sees it
expired calls refresh simultaneously with the same `refresh_token`.
GHL rotates `refresh_token` on success — the first request gets a new
pair, every later one using the same old token is rejected, and GHL
may invalidate the whole session.

**Fix: single-flight.** A module-level `Map<key, Promise>` ensures at
most one in-flight refresh per location. Concurrent callers await the
shared promise.

```ts
const refreshInFlight = new Map<string, Promise<StoredTokens | null>>()

export async function refreshAccessToken(key: string) {
  const existing = refreshInFlight.get(key)
  if (existing) return existing
  const promise = refreshImpl(key)
  refreshInFlight.set(key, promise)
  try { return await promise } finally { refreshInFlight.delete(key) }
}
```

### 4.2 No retry on transient failures

A single 5xx / network hiccup / timeout used to require manual
reconnect.

**Fix: up to 3 attempts with exponential backoff (400ms, 800ms,
1600ms).** Only `400 / 401 / 403` from `/oauth/token` short-circuits —
those mean `invalid_grant` and the token is genuinely dead.

### 4.3 Refresh request

```
POST https://services.leadconnectorhq.com/oauth/token
Content-Type: application/x-www-form-urlencoded

client_id=<id>
client_secret=<secret>
grant_type=refresh_token
refresh_token=<current>
user_type=<Location|Company — must match what was issued>
redirect_uri=${APP_URL}/api/auth/callback
```

### 4.4 Expiry margin

When saving tokens, set `expiresAt = now + (expires_in - 300) * 1000`.
The 5-minute safety margin leaves room for the refresh round-trip
before a real 401 could hit.

### 4.5 `getValidAccessToken(key)` — what every adapter call uses

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

Returning `null` means "reconnect required" — callers surface a
reconnect prompt rather than a generic 500.

### 4.6 Agency → location token swap (`getLocationToken`)

For agency-level installs (`userType: 'Company'`) you can get a per-
sub-account token via `POST /oauth/locationToken` with the agency
token. We use this rarely — most installs are Location-scoped from
the start — but the helper exists for completeness:

```
POST https://services.leadconnectorhq.com/oauth/locationToken
Authorization: Bearer <agency token>
Version: 2021-07-28
Content-Type: application/json

{ "companyId": "...", "locationId": "..." }
```

Returns the same `OAuthTokenResponse` shape; save it keyed by
`locationId` and proceed normally.

### 4.7 Placeholder + native locations skip refresh

Two synthetic Location IDs exist that should NOT be passed to
`/oauth/token`:

- `placeholder:<workspaceId>` — agent created before connecting any CRM
- `native:<workspaceId>` — Voxility's built-in CRM (no external auth)

Both have empty tokens. Skip refresh attempts for any key starting
with those prefixes.

---

## 5. REST API client (`lib/crm/ghl/adapter.ts`)

### 5.1 Shared fetch wrapper

Every request goes through one helper. Always pull a fresh token,
always set the version header, default to JSON.

```ts
const BASE_URL = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'

private async apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getValidAccessToken(this.locationId)
  if (!token) throw new Error(`No valid token for location: ${this.locationId}`)

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),     // per-call override (some endpoints want 2021-04-15)
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GHL API error ${res.status} on ${path}: ${body.slice(0, 500)}`)
  }
  return res.json() as Promise<T>
}
```

### 5.2 Version-pinning by endpoint family

GHL's API is versioned per endpoint family. Most things take `2021-07-28`,
but some explicitly require `2021-04-15` and will return validation
errors or 400s under the newer version:

| Endpoint family | Required Version header |
|---|---|
| `/contacts/*`, `/opportunities/*`, `/locations/*`, `/users/*`, `/companies/*`, `/workflows/*` | `2021-07-28` |
| `/conversations/*` (search, get, create, update, delete, messages, message status/schedule/inbound, recording, transcription, typing) | `2021-04-15` |
| `/calendars/*` (single calendar, free-slots, events/appointments, appointment notes) | `2021-04-15` |

The adapter sets `2021-07-28` as default and overrides via
`headers: { 'Version': '2021-04-15' }` on conversation + calendar
calls. Get this wrong and you'll see GHL return a 400 with a bare
"Bad Request" body and no field hints. Ask me how I know.

### 5.3 Endpoint catalogue (everything the adapter calls)

#### Contacts

| Op | Method | Path |
|---|---|---|
| Get one | GET | `/contacts/{contactId}` |
| Search | POST | `/contacts/search` (body: `{ locationId, query?, pageLimit }`) — GET `/contacts/?query=` is deprecated |
| Find duplicate | GET | `/contacts/search/duplicate?locationId=...&email=...&number=...` |
| Create | POST | `/contacts/` (body: `{ ...fields, locationId }`) |
| Upsert | POST | `/contacts/upsert` (body: `{ ...fields, locationId }`) — `email`+`phone` drive dedup |
| Update | PUT | `/contacts/{contactId}` |
| Delete | DELETE | `/contacts/{contactId}` |
| Add tags | POST | `/contacts/{contactId}/tags` (body: `{ tags: string[] }`) |
| Remove tags | DELETE | `/contacts/{contactId}/tags` (body: `{ tags: string[] }`) |
| List notes | GET | `/contacts/{contactId}/notes` |
| Create note | POST | `/contacts/{contactId}/notes` (body: `{ body, userId? }`) |
| Delete note | DELETE | `/contacts/{contactId}/notes/{noteId}` |
| List tasks | GET | `/contacts/{contactId}/tasks` |
| Create task | POST | `/contacts/{contactId}/tasks` (body: `{ title, body?, dueDate, completed?, assignedTo? }`) |
| Complete task | PUT | `/contacts/{contactId}/tasks/{taskId}/completed` (body: `{ completed }`) |
| Add to campaign | POST | `/contacts/{contactId}/campaigns/{campaignId}` |
| Remove from campaign | DELETE | `/contacts/{contactId}/campaigns/{campaignId}` |
| Add to workflow | POST | `/contacts/{contactId}/workflow/{workflowId}` |
| Remove from workflow | DELETE | `/contacts/{contactId}/workflow/{workflowId}` |
| Update custom field | PUT | `/contacts/{contactId}` body: `{ customFields: [{ key, field_value }] }` |

**DnD per-channel**: PUT `/contacts/{id}` with `dndSettings: { [channelKey]: { status: 'active', message, code } }`. Channel keys: `SMS | Email | WhatsApp | FB | IG | GMB | 'Live Chat'`. Unknown channel → set top-level `dnd: true` instead.

#### Conversations & Messaging (`Version: 2021-04-15`)

| Op | Method | Path |
|---|---|---|
| Search | GET | `/conversations/search?locationId=...&contactId=...&assignedTo=...&status=...&lastMessageType=...&query=...&limit=...` |
| Get one | GET | `/conversations/{conversationId}` |
| Create | POST | `/conversations/` (body: `{ locationId, contactId }`) |
| Update | PUT | `/conversations/{conversationId}` |
| Delete | DELETE | `/conversations/{conversationId}` |
| List messages | GET | `/conversations/{conversationId}/messages?limit=&type=&lastMessageId=` |
| Get message | GET | `/conversations/messages/{messageId}` |
| Send | POST | `/conversations/messages` (body: `SendMessagePayload`) |
| Record inbound | POST | `/conversations/messages/inbound` (body: `{ type, conversationId, conversationProviderId, message?, html?, ... }`) |
| Update status | PUT | `/conversations/messages/{messageId}/status` |
| Cancel scheduled message | DELETE | `/conversations/messages/{messageId}/schedule` |
| Cancel scheduled email | DELETE | `/conversations/messages/email/{emailMessageId}/schedule` |
| Get recording | GET | `/conversations/messages/{messageId}/locations/{locationId}/recording` (returns binary) |
| Get transcription | GET | `/conversations/locations/{locationId}/messages/{messageId}/transcription` |
| Live-chat typing | POST | `/conversations/providers/live-chat/typing` |

GHL's message types catalog (set as `type` on `SendMessagePayload`):
```
TYPE_CALL, TYPE_SMS, TYPE_EMAIL, TYPE_FACEBOOK, TYPE_GMB,
TYPE_INSTAGRAM, TYPE_WHATSAPP, TYPE_LIVE_CHAT,
TYPE_ACTIVITY_APPOINTMENT, TYPE_ACTIVITY_CONTACT, TYPE_ACTIVITY_INVOICE,
TYPE_ACTIVITY_PAYMENT, TYPE_ACTIVITY_OPPORTUNITY,
TYPE_INTERNAL_COMMENTS, TYPE_ACTIVITY_EMPLOYEE_ACTION_LOG
```

#### Opportunities

| Op | Method | Path |
|---|---|---|
| Search | GET | `/opportunities/search?location_id=...&pipeline_id=...&pipeline_stage_id=...&contact_id=...&status=...&assigned_to=...&page=&limit=&order=` (max limit 100) |
| Get one | GET | `/opportunities/{opportunityId}` |
| List pipelines | GET | `/opportunities/pipelines?locationId=...` |
| Create | POST | `/opportunities/` (body required: `name, contactId, pipelineId, pipelineStageId, locationId, status`) — **field is `name`, NOT `title`** |
| Update (stage) | PUT | `/opportunities/{opportunityId}` (body: `{ pipelineStageId }`) |
| Update (status) | PUT | `/opportunities/{opportunityId}/status` (body: `{ status }`) — `open | won | lost | abandoned` |
| Update (value) | PUT | `/opportunities/{opportunityId}` (body: `{ monetaryValue }`) |
| Delete | DELETE | `/opportunities/{opportunityId}` |
| Upsert | POST | `/opportunities/upsert` |
| Add follower | POST | `/opportunities/{opportunityId}/followers` |
| Remove follower | DELETE | `/opportunities/{opportunityId}/followers` |

#### Calendars (`Version: 2021-04-15`)

| Op | Method | Path |
|---|---|---|
| Get calendar | GET | `/calendars/{calendarId}` |
| List calendars | GET | `/calendars/?locationId=...` |
| Free slots | GET | `/calendars/{calendarId}/free-slots?startDate=...&endDate=...&timezone=...` |
| Book appointment | POST | `/calendars/events/appointments` |
| Get appointment | GET | `/calendars/events/appointments/{eventId}` |
| Update appointment | PUT | `/calendars/events/appointments/{eventId}` |
| List contact's events | GET | `/calendars/events?locationId=...&contactId=...&calendarId=...&startTime=...&endTime=...` |
| Create appointment note | POST | `/calendars/appointments/{appointmentId}/notes` |
| Update appointment note | PUT | `/calendars/appointments/{appointmentId}/notes/{noteId}` |

**`/free-slots` gotchas:**
- `startDate` and `endDate` are **numeric millisecond timestamps as strings**, NOT ISO strings.
- Max range is **31 days**. Longer ranges return 400; clamp client-side.
- Response shape: `{ "2024-10-28": { "slots": ["2024-10-28T10:00:00-05:00", ...] } }` — each slot is already a full ISO-with-offset string; don't concat the date key.

**`bookAppointment` gotchas:**
- Some calendars require `assignedUserId` — fetch the calendar's team
  members first and pick the lowest-priority one if the caller didn't
  pass one, else 422 "A team member needs to be selected".
- `startTime` and `endTime` must use the same time-format. Mixing an
  offset-suffixed start with a UTC-`Z` end triggers GHL's bare
  "Bad Request" with no field hint. Strip milliseconds (`.000`) too.
- Required body fields: `calendarId, locationId, contactId, startTime, endTime, title`.
- Default `appointmentStatus: 'confirmed'` — leaving `'new'` forces
  the operator to manually confirm every booking in GHL.

#### Locations + sub-account metadata

| Op | Method | Path |
|---|---|---|
| Get location | GET | `/locations/{locationId}` |
| List tags | GET | `/locations/{locationId}/tags` |
| Create tag | POST | `/locations/{locationId}/tags` (body: `{ name }`) |
| Custom fields (contact) | GET | `/locations/{locationId}/customFields` |
| Custom fields (opportunity) | GET | `/locations/{locationId}/customFields?model=opportunity` |

#### Users / Team members

| Op | Method | Path |
|---|---|---|
| Get user | GET | `/users/{userId}` |

Used to resolve `Contact.assignedTo` → name/email/phone for
`{{user.*}}` merge fields. 401 (missing scope) and 404 are
non-fatal — fall back to skipping the user merge fields.

#### Companies (agency-level)

| Op | Method | Path |
|---|---|---|
| Get company | GET | `/companies/{companyId}` |

Expect 403 on non-agency installs (the OAuth grant for sub-account
installs typically doesn't carry `companies.readonly`). Handle gracefully.

#### Workflows

| Op | Method | Path |
|---|---|---|
| List workflows | GET | `/workflows/?locationId=...` |

---

## 6. Webhooks (`/api/webhooks/events`)

GHL POSTs JSON event payloads to your registered webhook URL. We
subscribe to:

| Event | When | Payload (key fields) |
|---|---|---|
| `INSTALL` | Marketplace install | `{ type, appId, companyId, locationId, companyName?, userId? }` |
| `InboundMessage` | Contact sent a message on any channel | `{ type, locationId, contactId, conversationId, conversationProviderId?, messageId, body, messageType: 'SMS' \| 'Email' \| 'WhatsApp' \| 'FB' \| 'IG' \| 'GMB' \| 'Live_Chat', direction: 'inbound', dateAdded? }` |
| `OutboundMessage` | A message went out (could be agent, could be operator) | Same shape as inbound, `direction: 'outbound'` |
| `ContactCreate` | New contact in GHL | `{ type, locationId, id, firstName?, lastName?, email?, phone?, tags? }` (note: contactId is `id` here) |
| `ContactTagUpdate` | Tag added/removed | `{ type, locationId, contactId, tags: string[] }` — drives tag-based agent triggers |
| `OpportunityStageUpdate` | Opp moved between stages | `{ type, locationId, opportunityId, pipelineId, pipelineStageId, ... }` |
| `OpportunityStatusUpdate` | Opp won/lost/abandoned | similar |

### 6.1 Handler outline

```ts
// app/api/webhooks/events/route.ts
export const maxDuration = 300   // CRM webhooks trigger Anthropic loops; need >10s

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  if (!verifySignature(req, rawBody)) return new NextResponse('Invalid', { status: 401 })
  const payload = JSON.parse(rawBody)

  switch (payload.type) {
    case 'INSTALL':                /* logging; tokens come via OAuth callback */ break
    case 'InboundMessage':         /* full agent run — see §6.2 */              break
    case 'ContactCreate':          /* trigger evaluation */                     break
    case 'ContactTagUpdate':       /* tag-based agent triggers */               break
    case 'OpportunityStageUpdate': /* trigger evaluation */                     break
    default: console.log(`Unhandled event: ${payload.type}`)
  }
  return NextResponse.json({ received: true })
}
```

### 6.2 InboundMessage pipeline (the long one)

This is where the bulk of your business logic lives. Stages in order:

1. **Channel guard** — skip channels you don't handle.
2. **Token check** — `getTokens(p.locationId)`; if null, log and skip
   (location has been uninstalled or never installed).
3. **Persistence** — write a `MessageLog` row in `PENDING` so failures
   are observable.
4. **Debounce / idempotency** — GHL retries deliveries. Dedup on
   `messageId`. Buffer rapid-fire messages (3 within 8s) into one
   agent run.
5. **Pre-filter** — confirm there's at least one active agent on this
   location with at least one routing rule. If not, drop with
   `SKIPPED` status. Prevents silent fires from misconfigured
   workspaces.
6. **Routing** — `findMatchingAgent(locationId, contactId, message, channel)`
   — first-match wins, regex/tag/keyword rules.
7. **Run the agent** — Anthropic Messages API loop with tool calls
   against the CRM adapter.
8. **Send the reply** via the adapter's `sendMessage()`.

### 6.3 Signature verification

GHL doesn't sign marketplace webhooks today, but you can register a
`WEBHOOK_SECRET` and verify HMAC if/when they add it. The stub:

```ts
function verifySignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return true     // skip if not configured
  const sig = req.headers.get('x-webhook-signature')
  // HMAC-SHA256(rawBody, secret) === sig
  return true                  // TODO once GHL signs
}
```

---

## 7. iframe SSO handshake

Voxility is embedded as a Custom Menu Link inside the LeadConnector
agency dashboard. From inside the iframe, the client posts a
`REQUEST_USER_DATA` message to its parent. The marketplace responds
with an encrypted blob; the client POSTs that blob to
`/api/auth/leadconnector-iframe-handshake`. We decrypt, map the user
onto our DB, mint a session, set a separate `__Secure-voxility-embed-session`
cookie.

### 7.1 Encryption format (`lib/leadconnector-sso.ts`)

OpenSSL-compatible (CryptoJS.AES.encrypt default):

```
base64(  "Salted__" || salt[8] || ciphertext  )
```

Key + IV derived via **EVP_BytesToKey(MD5, sharedSecret, salt)** —
32 bytes of key + 16 bytes of IV for AES-256-CBC.

```ts
function evpBytesToKey(password: Buffer, salt: Buffer, keyLen: number, ivLen: number) {
  const out = Buffer.alloc(keyLen + ivLen); let written = 0; let prev = Buffer.alloc(0)
  while (written < keyLen + ivLen) {
    const hash = crypto.createHash('md5').update(prev).update(password).update(salt).digest()
    const take = Math.min(hash.length, keyLen + ivLen - written)
    hash.copy(out, written, 0, take); written += take; prev = hash
  }
  return { key: out.subarray(0, keyLen), iv: out.subarray(keyLen, keyLen + ivLen) }
}

export function decryptSsoBlob(encryptedBase64: string, sharedSecret: string) {
  const raw = Buffer.from(encryptedBase64, 'base64')
  if (raw.subarray(0, 8).toString('utf8') !== 'Salted__') throw new Error('not OpenSSL format')
  const salt = raw.subarray(8, 16); const ciphertext = raw.subarray(16)
  const { key, iv } = evpBytesToKey(Buffer.from(sharedSecret, 'utf8'), salt, 32, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(plain)
}
```

### 7.2 Decrypted payload shape

```ts
interface DecryptedSsoPayload {
  userId: string
  companyId: string
  activeLocation?: string       // sub-account id; undefined for agency-level menu
  type?: 'agency' | 'location'
  role?: 'admin' | 'user'
  userName?: string
  email?: string
}
```

### 7.3 Handshake handler

```
POST /api/auth/leadconnector-iframe-handshake
{ "encryptedData": "<base64 from marketplace>" }
```

1. Decrypt with `LEADCONNECTOR_SSO_KEY`. 400 on failure.
2. Find the Location by `activeLocation`, or fall back to most-recent
   Location with this `companyId` (agency-level menu).
3. 404 if no Location → user must reinstall via marketplace.
4. `db.user.upsert({ where: { email }, ... emailVerified: new Date() })`
   — upsert not findUnique-then-create (TOCTOU race), and write
   `emailVerified` on both branches so legacy NULL rows self-heal
   (otherwise NextAuth's `allowDangerousEmailAccountLinking` won't
   auto-link a fresh Google account later).
5. Upsert `WorkspaceMember` with role from payload (`admin` if
   `payload.role === 'admin'`, else `member`). Refresh role on every
   handshake — marketplace payload is the source of truth — except
   never demote an `owner`.
6. Mint a NextAuth database session (`Session` row with random 32-byte
   `sessionToken`, 90-day expiry).
7. Set TWO cookies on the response:

   - `__Secure-voxility-embed-session` — the session token (separate
     name from the regular NextAuth cookie so a passive cross-site
     iframe load can't piggyback on it).
   - `__Secure-voxility-embed-workspace` — the bound workspaceId, so
     when the user navigates to `/dashboard` inside the iframe the
     root redirect knows which workspace they're in (otherwise users
     with multiple marketplace installs land on whichever workspace
     appears first in their list).

   Both `httpOnly`, `secure`, `sameSite: 'none'`, `path: '/'`,
   `maxAge: 90 days`.

8. Return `{ ok: true, workspaceId, locationId, redirectTo: '/dashboard/<wsId>/agents?embedded=leadconnector' }`.

### 7.4 Middleware cookie promotion

Downstream `auth()` calls hard-bind to the regular NextAuth cookie
name. Middleware copies the embed cookie value onto the regular cookie
name on the **request side** (browser still sees them as separate
cookies, only the request that goes through middleware sees the
promoted value):

```ts
// middleware.ts
const regular = request.cookies.get(REGULAR_SESSION_COOKIE)
const embed = request.cookies.get(EMBED_SESSION_COOKIE)
if (!regular && embed) {
  request.cookies.set(REGULAR_SESSION_COOKIE, embed.value)
}
```

### 7.5 CSP for iframe parents

`next.config.ts` sets `Content-Security-Policy: frame-ancestors *` on
`/dashboard/*`, `/embedded/*`, and the handshake route. Agencies
resell on thousands of whitelabel domains; we can't enumerate them.
The security model is the signed handshake (anyone fabricating a
payload without the Shared Secret fails decrypt), not parent-origin
trust.

### 7.6 Client-side iframe state

`EmbeddedProvider` reads `?embedded=leadconnector` on first mount and
writes `sessionStorage['voxility:embedded-host'] = 'leadconnector'`.
`useEmbedded()` reads sessionStorage + `window.parent !== window` for
reliable per-tab iframe detection. sessionStorage is per-tab — iframe
tab has it, main browser tab doesn't, no cross-contamination risk.

The iframe entry URL `/embedded/leadconnector` is **unique** — regular
browser tabs never hit it — so cookie-based "is this an iframe?"
detection is unnecessary. The handshake redirects to
`/dashboard/<wsId>/agents?embedded=leadconnector` and from then on
sessionStorage carries the signal.

---

## 8. Disconnect flow

`DELETE /api/workspaces/:wsId/integrations` does **not** delete the
Location row. It:

1. Blanks `accessToken`, `refreshToken`, `refreshTokenId` on every
   real (non-native, non-placeholder) Location for the workspace.
2. Flips `crmProvider: 'native'` so the integrations page renders as
   disconnected and the adapter factory stops routing to GHL.
3. Leaves `MessageLogs`, `Agents`, `RoutingRules`, `ChannelDeployments`
   intact — reconnect resumes cleanly because the OAuth callback re-
   fills tokens on the same Location row (keyed by GHL `locationId`)
   and resets `crmProvider: 'ghl'`.

Webhooks for a disconnected Location no-op safely: the InboundMessage
handler calls `getTokens(locationId)`, gets null because tokens are
blank, logs "No tokens for location ..." and breaks before any agent
runs.

---

## 9. Whitelabel considerations

LeadConnector agencies resell on their own branded subdomains
(`app.acmeagency.com`, `crm.example.io`, etc.). Three places this
matters:

1. **CSP frame-ancestors** — must be `*` on `/dashboard/*`,
   `/embedded/*`, and the handshake route. Enumeration is impossible.
2. **Customer-facing copy** — say "your CRM", not "LeadConnector" or
   "GoHighLevel". There is no whitelabel-name API; don't invent one.
3. **Dashboard URL** — build links to the sub-account dashboard using
   `LEADCONNECTOR_DASHBOARD_BASE_URL` (default `https://app.voxility.ai`)
   so each deploy can point at its own whitelabel host. See
   `lib/leadconnector-dashboard-url.ts`.

---

## 10. Common failure modes & how to spot them

| Symptom | Likely cause | Where to look |
|---|---|---|
| "Tags scope missing" after reconnect | Marketplace listing dropped the scope; or stale Location row | `[OAuth] Granted scope is MISSING …` warn line in callback |
| Bookings 401 silently | Missing `calendars/events.write` scope | Re-issue OAuth with the full scope list in §2.2 |
| `/oauth/token` 400 with `invalid_grant` | Refresh token was rotated by a concurrent refresh; user needs to reconnect | TokenStore logs |
| 422 "A team member needs to be selected" | Calendar requires `assignedUserId`; auto-pick from `pickCalendarTeamMember` | `bookAppointment` body |
| GHL returns bare "Bad Request" with no field hint on `/calendars/events/appointments` | `startTime` and `endTime` formats don't match (offset vs Z), or millisecond precision in the ISO string | Format both with the same offset, strip `.000` |
| `/free-slots` 400 "invalid range" | `endDate` > `startDate` + 31 days, or you passed ISO strings instead of millisecond timestamps | Convert with `Date.parse() → ms`, clamp to 31 days |
| Ghost agent fires on the new workspace after reinstall | Agent's `workspaceId` still points at the old workspace | OAuth callback step 6: `cascadeAgentsToWorkspace` must run |
| iframe handshake 400 "could not verify" | Wrong `LEADCONNECTOR_SSO_KEY`, OR marketplace changed its encryption scheme | The decrypt throws on the `Salted__` prefix check |
| User stuck on wrong workspace in iframe | `__Secure-voxility-embed-workspace` cookie missing or out of date | Handshake must always rewrite the cookie even on re-load |

---

## 11. Reference file map (this codebase)

If you're porting from this repo, the relevant files are:

```
app/api/auth/crm/connect/route.ts                      OAuth init
app/api/auth/callback/route.ts                         OAuth callback
app/api/auth/leadconnector-iframe-handshake/route.ts   iframe SSO
app/api/webhooks/events/route.ts                       webhook handler
lib/token-store.ts                                     token storage + refresh
lib/leadconnector-install-fetcher.ts                   install snapshot
lib/leadconnector-sso.ts                               SSO decryption
lib/leadconnector-dashboard-url.ts                     whitelabel dashboard URL builder
lib/oauth-install.ts                                   callback helpers (cascade, snapshot write, naming)
lib/embed-session.ts                                   cookie name constants
lib/workspace-crm-connections.ts                       Location ↔ MarketplaceInstall join
lib/crm/ghl/adapter.ts                                 REST API client (1188 lines)
lib/crm/factory.ts                                     adapter factory (provider routing)
lib/crm/types.ts                                       CrmAdapter interface
middleware.ts                                          cookie promotion + dashboard auth gate
next.config.ts                                         CSP frame-ancestors
prisma/schema.prisma                                   Location, MarketplaceInstall, Workspace, Agent
types/index.ts                                         OAuthTokenResponse, webhook payloads
```

---

## 12. Minimum viable port checklist

If you're rebuilding this from scratch in another codebase, hit these
in order:

- [ ] Set up env vars (§1)
- [ ] Register Marketplace app with redirect URI + webhook URL + scopes from §2.2
- [ ] Implement `GET /auth/crm/connect` (§2.1)
- [ ] Implement `GET /auth/callback` (§2.5) — at minimum: token exchange, save tokens, redirect
- [ ] Implement token store with single-flight refresh (§4) — the thundering-herd bug WILL bite you within a week of going live without it
- [ ] Implement the shared `apiFetch` wrapper with version pinning (§5.1, §5.2)
- [ ] Implement the contacts + conversations + sendMessage subset (§5.3) — enough to receive an InboundMessage webhook and reply
- [ ] Implement `POST /webhooks/events` with the `InboundMessage` branch (§6)
- [ ] Add install snapshot fetch + persistence (§3) if you want to surface the business name in your UI
- [ ] Add iframe SSO handshake (§7) if you want a Custom Menu Link entry point
- [ ] Add the disconnect endpoint (§8)

Stages 1–7 get you a working "agent receives SMS, replies via GHL"
loop. Everything else is enrichment.
