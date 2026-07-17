# Personalized Voice Demos at Scale ("Try Your AI Receptionist")

**Date:** 2026-07-17
**Status:** Approved design, pre-implementation

## Overview

An outbound prospecting tool (separate system) discovers business owners and cold-emails
each one a unique link (`xovera.io/try/<slug>`). The link opens a landing page where a
Gemini voice agent answers a browser call *as that prospect's business* — greeting with
their business name, answering questions from knowledge crawled off their own website.
If they like it, the CTA takes them through signup → claim → Stripe checkout, and the
demo agent becomes their real agent.

Everything is assembled from existing infrastructure: the public browser voice demo
(`app/api/public/voice-demo/web-token`), `buildGeminiVoiceSession()` with `ragContext`
injection, the `lib/ingest` crawl→embed pipeline, the `app/c/[slug]` hosted-call page
pattern, the Harry-demo abuse guards, and `/api/billing/checkout`.

## Goals

- Provision personalized voice demos programmatically at cold-email scale.
- Zero cost per prospect until they click (lazy provisioning).
- Convert warm prospects: post-call CTA → signup → **checkout** → demo becomes their agent.
- Give the prospecting tool engagement signals (clicked / called / duration) via API.

## Non-goals (v1)

- Phone-number demos (browser call only).
- Email sending, sequencing, or deliverability (prospecting tool owns that).
- Dashboard UI for browsing prospects (the API is the interface).
- Pre-warming on email open.

## Decisions made

| Decision | Choice |
|---|---|
| Demo medium | Browser click-to-call on the landing page only |
| Provisioning timing | Lazy — on first landing-page visit, not at email-send time |
| Prospecting tool integration | Separate tool calling a secret-keyed Xovera API |
| Tenancy | All demo agents live in one internal demos workspace (`DEMO_WORKSPACE_ID`) |
| Call cap | ~3 minutes (env-tunable) |
| Idempotency | One live demo prospect per website domain |
| Conversion | Primary CTA → signup (slug carried through) → claim into new workspace → Stripe checkout; secondary "Learn more" CTA → matching vertical landing page |
| Branding | Xovera (xovera.io) everywhere — no legacy brand names in copy, routes, or identifiers |

## Architecture

### 1. Data model — `DemoProspect`

New Prisma model + hand-run SQL (per house rules; the build never auto-migrates).

```
DemoProspect
  id                String   @id @default(cuid())
  slug              String   @unique          // e.g. acme-plumbing-x7k2
  businessName      String
  websiteUrl        String
  websiteDomain     String                     // normalized, unique among non-expired rows
  contactEmail      String?
  vertical          String?                    // maps to a vertical landing page + template preset
  templates         Json?                      // optional per-prospect prompt/instructions/firstMessage overrides
  metadata          Json?                      // free-form from the prospecting tool (also feeds template variables)
  status            String   @default("registered")
                    // registered → provisioning → ready → failed / expired / claimed
  agentId           String?                    // set at provision time
  knowledgeDomainId String?
  ingestionRunId    String?
  clickedAt         DateTime?
  firstCallAt       DateTime?
  callCount         Int      @default(0)
  totalCallSecs     Int      @default(0)
  claimedByUserId   String?
  claimedWorkspaceId String?
  expiresAt         DateTime?                  // set when provisioned; default +14 days
  createdAt / updatedAt
```

Indexes on `status`, `websiteDomain`, `expiresAt`.

### 2. Provisioning API (for the prospecting tool)

- `POST /api/v1/demo-prospects` — auth via existing `lib/api-key.ts` with a new
  `demos:write` scope. Body: `{businessName, websiteUrl, contactEmail?, vertical?,
  promptTemplate?, instructionsTemplate?, firstMessageTemplate?, metadata?}`.
  Returns `{slug, url}`. Idempotent on normalized website domain: if a non-expired
  prospect exists for the domain, return its existing slug instead of creating another.
  Cheap insert only — no crawl, no agent.
- `GET /api/v1/demo-prospects?since=<iso>&status=<s>` — `demos:read` scope. Returns
  engagement fields (clickedAt, firstCallAt, callCount, totalCallSecs, status) so the
  tool can prioritize follow-up on prospects who actually called.

Naming follows house rules: no CRM-brand terms; routes/identifiers are generic.

**Dynamic agent templating (the core mechanic).** The demo agent is built from
templates with per-prospect variable substitution. Available variables:
`{{businessName}}`, `{{websiteDomain}}`, `{{vertical}}`, plus anything the
prospecting tool passes in `metadata` (e.g. `{{ownerFirstName}}`, `{{city}}`).
Resolution order per field (prompt, instructions, first message):

1. Per-prospect override passed in the POST body (full control per campaign).
2. Per-vertical preset (a small in-repo map, e.g. med-spa vs gym receptionist
   personas — tuned copy per target vertical).
3. Global default template ("You are the AI receptionist for {{businessName}}…").

Templates render at provision time into the concrete `Agent.systemPrompt` /
`Agent.instructions` / `GeminiVoiceConfig.firstMessage`, so the voice runtime
needs zero changes — it just sees a normal agent. Unknown variables render as
empty; templating helpers are pure functions under `lib/` (vitest-covered).

### 3. Landing page `/try/[slug]`

Cloned structurally from `app/c/[slug]/page.tsx`. Server component loads the
`DemoProspect`; behavior by status:

- **registered** — stamp `clickedAt`, flip to `provisioning`, kick off provisioning
  (below), render the build sequence: "Reading acmeplumbing.com… Learning your
  services… Training your receptionist…" with client-side polling of a public status
  endpoint (`GET /api/public/try/[slug]/status`). This 60–90s moment is part of the pitch.
- **provisioning** — same polling view (handles refresh/second visit).
- **ready** — hero with the business name ("This is what {businessName}'s AI
  receptionist sounds like"), big call button, and the CTA pair (below). Footer
  disclaimer: built by Xovera as a demo, not affiliated with or endorsed by the
  business. Page is `noindex`.
- **failed** — graceful copy + the same CTAs (book a call / learn more).
- **expired / claimed** — no call button; CTA-only page ("Get this for {businessName}").

Provisioning (server-side, idempotent, triggered by first visit):
1. Create a per-prospect `KnowledgeDomain` in the demos workspace.
2. Create `KnowledgeSource` + queued `IngestionRun` for `websiteUrl` (existing
   `lib/ingest` pipeline; the every-minute `ingest-queue` cron does the work).
3. Create `Agent` (templated system prompt: AI receptionist for {businessName},
   reactive kind, `knowledgeScopeAll: false`, `knowledgeDomainIds: [domain]`, no tools)
   + `GeminiVoiceConfig` (`firstMessage`: "Thanks for calling {businessName}! How can
   I help you today?", `maxDurationSecs` from env).
4. Set `expiresAt = now + DEMO_PROSPECT_TTL_DAYS` (default 14), status → `ready`
   as soon as the agent exists. The crawl finishing is *not* a readiness gate —
   if ingestion is still running or fails, the demo goes live with whatever chunks
   landed; greeting + business name alone carries the moment. Status only becomes
   `failed` if agent creation itself fails. The status endpoint reports ingestion
   progress separately so the build sequence can be honest about it.

### 4. Demo call token route

`POST /api/public/try/[slug]/web-token` — parameterized sibling of the existing
single-agent `voice-demo/web-token` route:

- Resolve prospect (must be `ready`) → agent + `GeminiVoiceConfig`.
- `retrieveChunks()` scoped to the prospect's `knowledgeDomainId`, injected as
  `ragContext` into `buildGeminiVoiceSession()`.
- Tools stripped; hard cap `DEMO_TRY_MAX_SECS` (default 180).
- Abuse guards ported from the Harry demo onto this path: global concurrency cap
  (`DEMO_TRY_MAX_CONCURRENT`), one live call per IP + cooldown, per-browser cookie
  cooldown, sessions tagged `demo: true` (skips self-training / ticket generation),
  cron reaper for wall-clock enforcement.
- On session end, increment `callCount` / `totalCallSecs`, stamp `firstCallAt`.

### 5. Conversion: dual CTA → claim → checkout

Ready/post-call/expired pages carry two CTAs:

- **Primary — "Get this for {businessName}"** → `/signup?demo=<slug>` (slug also
  persisted in a short-lived cookie to survive the OAuth round-trip) → claim →
  checkout.
- **Secondary — "Learn more"** → the vertical landing page matched from
  `vertical` via a small in-repo map (e.g. med-spa → `/ai-for-med-spas`,
  gym → `/ai-for-gyms`; fallback `/ai-receptionist`), with `?demo=<slug>`
  appended so attribution survives and the vertical page's own CTAs can route
  back into the same claim flow.

After the primary CTA: After authentication and workspace creation, a claim step
(`POST /api/demo-prospects/[slug]/claim`, session-authed):

1. Move the demo assets into the user's new workspace: re-parent the `Agent`,
   `GeminiVoiceConfig`, and `KnowledgeDomain` (+ sources/chunks) from the demos
   workspace to the claimed workspace. Their demo *becomes* their real agent —
   no rebuild, strongest conversion story.
2. Mark the prospect `claimed` (`claimedByUserId`, `claimedWorkspaceId`), clear
   `expiresAt` so the reaper never touches claimed assets.
3. Redirect into plan selection / `POST /api/billing/checkout` (existing Stripe
   flow). Because voice entitlement is plan-derived, the plan picker highlights
   plans that include voice minutes.

If the user abandons checkout, they still have the claimed agent in their workspace
under the normal trial rules — the existing billing/trial system handles it from there.

### 6. Lifecycle & cleanup

Daily cron (`app/api/cron/demo-prospect-reaper`, `CRON_SECRET`-guarded, registered in
`vercel.json`): for prospects past `expiresAt` and not `claimed` — delete the agent,
voice config, knowledge domain + sources/chunks; keep the `DemoProspect` row with
status `expired` (analytics + graceful link degradation). Also reaps `registered`
rows older than 90 days.

### 7. Security & abuse posture

- Provisioning API is API-key gated (`demos:*` scopes); the only unauthenticated
  writes are (a) the first-visit provisioning trigger and (b) the token mint —
  both keyed to an existing slug, so mass abuse requires mass valid slugs.
- Slugs include a random suffix (unguessable, unenumerable).
- Crawl targets come only from the API-key-holding prospecting tool, not from
  visitor input — no SSRF surface on the public page.
- Per-IP + concurrency + time caps bound worst-case Gemini/Voyage spend.
- Demo sessions never self-train and never create tickets.
- Clear on-page disclaimer that the page is a Xovera demo (we present the
  prospect's brand to the prospect themselves; the page must not read as the
  business's own public site). `noindex` on all `/try/*`.

### 8. Env vars

- `DEMO_WORKSPACE_ID` — internal demos workspace.
- `DEMO_TRY_MAX_SECS` (180), `DEMO_TRY_MAX_CONCURRENT` (15), `DEMO_TRY_IP_COOLDOWN_SECS` (120).
- `DEMO_PROSPECT_TTL_DAYS` (14).

### 9. Ships with

- Hand-run SQL file for `DemoProspect` (+ any new API-key scope seed), per the
  migrations-by-hand rule.
- `<NewBadge>` + `FEATURE_SHIP_DATES` entry if/when any dashboard-visible surface
  is added (v1 has none — public + API only, so no badge target yet).

## Error handling summary

| Failure | Behavior |
|---|---|
| Crawl fails / times out | Demo still goes `ready`; agent answers from prompt + greeting only |
| Agent creation fails | Status `failed`; landing page shows graceful CTA copy |
| Duplicate registration | Idempotent — existing slug returned |
| Expired link visited | CTA-only page, no 404 |
| Abuse (IP/concurrency/time) | 429 with friendly on-page message; hard caps bound spend |

## Testing

- Unit (vitest, `lib/**`): slug generation, domain normalization/idempotency,
  prompt/greeting templating, status transitions (pure helpers).
- Route behavior verified via the scenario harness / manual pass per repo convention
  (route handlers are out of vitest scope).
- Live verification before "done": provision a real prospect against a test site,
  click through the landing page, complete a browser call, confirm guards 429
  correctly, and walk the claim → checkout path.
