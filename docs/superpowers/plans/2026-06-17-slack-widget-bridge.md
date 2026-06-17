# Slack Widget-Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bridge widget conversations to a Slack channel (one thread per conversation) so a human can reply from Slack and the reply lands in the visitor's widget, with the visitor experience unchanged.

**Architecture:** A shared Voxility Slack App (OAuth bot token per workspace) posts each bridged conversation as a channel thread via an outbox queue + cron (mirroring `lib/native-outbox.ts`). A signature-verified Slack Events route reads thread replies and feeds them back through the existing handoff path (`WidgetMessage` role=`agent` + `sentByUserId`, `status='handed_off'`, `ConversationStateRecord` PAUSED, `broadcast()` with `fromHuman:true`). A `!`-prefixed Slack reply becomes an internal `ConversationNote` instead.

**Tech Stack:** Next.js 16 (App Router, `after()`), Prisma 7 / Postgres, `lib/secrets.ts` (AES-256-GCM), Vitest (pure helpers only), Slack Web API (`chat.postMessage`, `oauth.v2.access`, `conversations.list`, `users.info`).

**Reference spec:** `docs/superpowers/specs/2026-06-17-slack-widget-bridge-design.md`

**Branch:** `slack-widget-bridge` (already created; carries the in-flight `WidgetMessage.sentByUserId` migration this plan depends on).

---

## File Structure

**New files**
- `lib/slack/signature.ts` — verify Slack request signatures (pure). + test.
- `lib/slack/parse.ts` — private-prefix (`!`) detection + text normalization (pure). + test.
- `lib/slack/client.ts` — thin Slack Web API wrapper (fetch-based; OAuth exchange, postMessage, conversations.list, users.info).
- `lib/slack/connection.ts` — `SlackConnection` read/write helpers (token encrypt/decrypt via `lib/secrets.ts`).
- `lib/slack/bridge.ts` — orchestration: `shouldBridge`, `ensureSlackThread`, `mirrorVisitorMessage`, `mirrorAgentMessage`, `applySlackReply`.
- `lib/slack/outbox.ts` — `enqueueSlackMessage` + `drainSlackOutbox` (atomic-claim drain).
- `app/api/integrations/slack/install/route.ts` — OAuth start (redirect to Slack).
- `app/api/integrations/slack/callback/route.ts` — OAuth callback (token exchange, persist `SlackConnection`).
- `app/api/integrations/slack/events/route.ts` — Slack Events API receiver (signature-verified, dedup, `after()`).
- `app/api/cron/slack-outbox/route.ts` — every-minute drain.
- `app/dashboard/[workspaceId]/integrations/slack/page.tsx` — connect/disconnect + channel picker UI.
- `app/api/workspaces/[workspaceId]/integrations/slack/channels/route.ts` — list channels for the picker.
- `app/api/workspaces/[workspaceId]/integrations/slack/route.ts` — GET status / PATCH default channel / DELETE disconnect.
- `slack/manifest.yaml` + `slack/README.md` — app manifest + setup notes (not shipped code; ops reference).

**Modified files**
- `prisma/schema.prisma` — new models + `Agent`/`WidgetConversation` fields.
- `prisma/migrations/<ts>_slack_widget_bridge/migration.sql` — hand-authored SQL.
- `lib/widget-agent-runner.ts` — bridge inbound visitor messages; suppress AI in `slack_only`.
- `lib/widget-adapter.ts` — mirror AI replies into Slack when bridged.
- `vercel.json` — register the `slack-outbox` cron.
- `app/dashboard/[workspaceId]/agents/[agentId]/...` (per-agent settings page) — `slackBridgeMode` + channel override control via `useDirtyForm` + `<SaveBar>`.
- `lib/feature-ship-dates.ts` (or wherever `FEATURE_SHIP_DATES` lives) — add entry; `<NewBadge>` on the integration menu item.

---

## Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_slack_widget_bridge/migration.sql`

- [ ] **Step 1: Add models + fields to `schema.prisma`**

Add near the other workspace-scoped models:

```prisma
model SlackConnection {
  id                 String   @id @default(cuid())
  workspaceId        String   @unique
  workspace          Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  teamId             String
  teamName           String?
  botToken           String   // AES-256-GCM via lib/secrets.ts (never plaintext)
  botUserId          String
  appId              String?
  scopes             String?
  defaultChannelId   String?
  defaultChannelName String?
  installedByUserId  String?
  installedByUser    User?    @relation("SlackConnectionInstaller", fields: [installedByUserId], references: [id], onDelete: SetNull)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@index([teamId])
}

model SlackOutbox {
  id             String   @id @default(cuid())
  workspaceId    String
  conversationId String
  channelId      String
  threadTs       String?  // null on a kind='parent' row
  kind           String   // "parent" | "reply"
  text           String   @db.Text
  blocks         Json?
  status         String   @default("queued") // queued | sending | sent | failed
  attempts       Int      @default(0)
  lastError      String?  @db.Text
  slackTs        String?  // ts returned by Slack on success
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([status, createdAt])
  @@index([conversationId])
}

model ProcessedSlackEvent {
  eventId   String   @id
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

Add to `model Agent` (after the other config fields, e.g. near `languages`):

```prisma
  slackBridgeMode String  @default("off") // "off" | "ai_with_handoff" | "slack_only"
  slackChannelId  String?                  // per-agent channel override
```

Add to `model WidgetConversation` (near `assignedUserId`):

```prisma
  slackChannelId String?
  slackThreadTs  String?
```

Add relations: on `model User` add `slackConnections SlackConnection[] @relation("SlackConnectionInstaller")`; on `model Workspace` add `slackConnection SlackConnection?`.

- [ ] **Step 2: Author the migration SQL by hand**

Create `prisma/migrations/<timestamp>_slack_widget_bridge/migration.sql` (use a timestamp after `20260617000000`). Make it idempotent to match the repo's `IF NOT EXISTS` convention:

```sql
-- Slack widget-bridge: per-workspace Slack install, outbound queue,
-- inbound event dedup, and per-agent / per-conversation bridge state.

CREATE TABLE IF NOT EXISTS "SlackConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL UNIQUE,
  "teamId" TEXT NOT NULL,
  "teamName" TEXT,
  "botToken" TEXT NOT NULL,
  "botUserId" TEXT NOT NULL,
  "appId" TEXT,
  "scopes" TEXT,
  "defaultChannelId" TEXT,
  "defaultChannelName" TEXT,
  "installedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SlackConnection_teamId_idx" ON "SlackConnection"("teamId");

CREATE TABLE IF NOT EXISTS "SlackOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "threadTs" TEXT,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "blocks" JSONB,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "slackTs" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SlackOutbox_status_createdAt_idx" ON "SlackOutbox"("status","createdAt");
CREATE INDEX IF NOT EXISTS "SlackOutbox_conversationId_idx" ON "SlackOutbox"("conversationId");

CREATE TABLE IF NOT EXISTS "ProcessedSlackEvent" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProcessedSlackEvent_createdAt_idx" ON "ProcessedSlackEvent"("createdAt");

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "slackBridgeMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "slackChannelId" TEXT;

ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "slackChannelId" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "slackThreadTs" TEXT;

DO $$ BEGIN
  ALTER TABLE "SlackConnection" ADD CONSTRAINT "SlackConnection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SlackConnection" ADD CONSTRAINT "SlackConnection_installedByUserId_fkey"
    FOREIGN KEY ("installedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 3: Regenerate the Prisma client (no DB write)**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" with no error. Do NOT run `prisma migrate dev` — Ryan applies SQL by hand (see `prisma/MIGRATIONS.md`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (new fields/models resolve).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(slack): schema for Slack widget-bridge (connection, outbox, dedup, agent+convo fields)"
```

---

## Task 2: Signature verification helper (TDD)

**Files:**
- Create: `lib/slack/signature.ts`
- Test: `lib/slack/signature.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { verifySlackSignature } from './signature'
import { createHmac } from 'node:crypto'

function sign(secret: string, ts: string, body: string) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
}

describe('verifySlackSignature', () => {
  const secret = 'shhh'
  const body = '{"type":"event_callback"}'
  const now = 1_000_000

  it('accepts a valid signature', () => {
    const ts = String(now)
    const sig = sign(secret, ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body, nowSeconds: now })).toBe(true)
  })

  it('rejects a tampered body', () => {
    const ts = String(now)
    const sig = sign(secret, ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body: body + 'x', nowSeconds: now })).toBe(false)
  })

  it('rejects a stale timestamp (>5 min)', () => {
    const ts = String(now - 6 * 60)
    const sig = sign(secret, ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body, nowSeconds: now })).toBe(false)
  })

  it('rejects a missing/garbage signature', () => {
    expect(verifySlackSignature({ secret, signature: '', timestamp: String(now), body, nowSeconds: now })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/slack/signature.test.ts`
Expected: FAIL ("verifySlackSignature is not a function" / module not found).

- [ ] **Step 3: Implement**

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifySlackSignature(args: {
  secret: string
  signature: string | null | undefined
  timestamp: string | null | undefined
  body: string
  nowSeconds?: number
}): boolean {
  const { secret, signature, timestamp, body } = args
  if (!secret || !signature || !timestamp) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 5 * 60) return false // replay window

  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/slack/signature.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/signature.ts lib/slack/signature.test.ts
git commit -m "feat(slack): request-signature verification helper"
```

---

## Task 3: Private-prefix parsing helper (TDD)

**Files:**
- Create: `lib/slack/parse.ts`
- Test: `lib/slack/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { classifySlackReply } from './parse'

describe('classifySlackReply', () => {
  it('treats a plain reply as visitor-facing', () => {
    expect(classifySlackReply('Hi there, how can I help?')).toEqual({
      visibility: 'public', text: 'Hi there, how can I help?',
    })
  })

  it('routes a !-prefixed reply to an internal note and strips the marker', () => {
    expect(classifySlackReply('!who is taking this?')).toEqual({
      visibility: 'internal', text: 'who is taking this?',
    })
  })

  it('strips a single space after the marker', () => {
    expect(classifySlackReply('! grabbing it')).toEqual({
      visibility: 'internal', text: 'grabbing it',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(classifySlackReply('   hello  ')).toEqual({ visibility: 'public', text: 'hello' })
  })

  it('returns empty text for marker-only messages', () => {
    expect(classifySlackReply('!')).toEqual({ visibility: 'internal', text: '' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/slack/parse.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
export type SlackReplyClass = {
  visibility: 'public' | 'internal'
  text: string
}

/**
 * A Slack thread reply is visitor-facing by default. A leading `!`
 * marks it internal — saved as a ConversationNote, never sent to the
 * visitor. We strip the marker (and one optional following space).
 */
export function classifySlackReply(raw: string): SlackReplyClass {
  const trimmed = (raw ?? '').trim()
  if (trimmed.startsWith('!')) {
    return { visibility: 'internal', text: trimmed.slice(1).replace(/^ /, '') }
  }
  return { visibility: 'public', text: trimmed }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/slack/parse.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/slack/parse.ts lib/slack/parse.test.ts
git commit -m "feat(slack): classify thread replies (public vs internal !-prefix)"
```

---

## Task 4: Slack Web API client

**Files:**
- Create: `lib/slack/client.ts`

- [ ] **Step 1: Implement the wrapper**

Read `lib/notifications.ts` `dispatchSlack()` first to match fetch/error conventions. Then:

```typescript
const SLACK_API = 'https://slack.com/api'

async function slackPost<T = any>(method: string, token: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as any
  if (!json.ok) throw new Error(`slack ${method} failed: ${json.error ?? res.status}`)
  return json as T
}

export async function exchangeOAuthCode(args: { code: string; clientId: string; clientSecret: string; redirectUri: string }) {
  const params = new URLSearchParams({
    code: args.code, client_id: args.clientId, client_secret: args.clientSecret, redirect_uri: args.redirectUri,
  })
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const json = (await res.json()) as any
  if (!json.ok) throw new Error(`slack oauth.v2.access failed: ${json.error}`)
  return {
    botToken: json.access_token as string,
    botUserId: json.bot_user_id as string,
    appId: json.app_id as string | undefined,
    scopes: json.scope as string | undefined,
    teamId: json.team?.id as string,
    teamName: json.team?.name as string | undefined,
    installedByUserId: json.authed_user?.id as string | undefined,
  }
}

export async function postMessage(token: string, args: { channel: string; text: string; thread_ts?: string; blocks?: unknown[] }) {
  const json = await slackPost<{ ts: string; channel: string }>('chat.postMessage', token, args)
  return { ts: json.ts, channel: json.channel }
}

export async function listChannels(token: string) {
  const json = await slackPost<{ channels: Array<{ id: string; name: string; is_member: boolean }> }>(
    'conversations.list', token, { types: 'public_channel,private_channel', exclude_archived: true, limit: 1000 },
  )
  return json.channels.map((c) => ({ id: c.id, name: c.name, isMember: c.is_member }))
}

export async function getUserInfo(token: string, userId: string) {
  const json = await slackPost<{ user: { id: string; real_name?: string; profile?: { email?: string; display_name?: string } } }>(
    'users.info', token, { user: userId },
  )
  const u = json.user
  return { id: u.id, email: u.profile?.email, displayName: u.profile?.display_name || u.real_name || u.id }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/slack/client.ts
git commit -m "feat(slack): minimal Slack Web API client (oauth, postMessage, channels, users)"
```

---

## Task 5: Connection store

**Files:**
- Create: `lib/slack/connection.ts`

- [ ] **Step 1: Inspect the secrets helper**

Read `lib/secrets.ts` and note the exact exported encrypt/decrypt function names (e.g. `encryptSecret` / `decryptSecret`). Use those names below; adjust if they differ.

- [ ] **Step 2: Implement**

```typescript
import { db } from '@/lib/db'
import { encryptSecret, decryptSecret } from '@/lib/secrets'

export async function getSlackConnection(workspaceId: string) {
  return db.slackConnection.findUnique({ where: { workspaceId } })
}

export async function getDecryptedBotToken(workspaceId: string): Promise<string | null> {
  const conn = await db.slackConnection.findUnique({ where: { workspaceId } })
  if (!conn) return null
  return decryptSecret(conn.botToken)
}

export async function upsertSlackConnection(input: {
  workspaceId: string
  teamId: string
  teamName?: string
  botToken: string // plaintext; encrypted here
  botUserId: string
  appId?: string
  scopes?: string
  installedByUserId?: string
}) {
  const botToken = encryptSecret(input.botToken)
  return db.slackConnection.upsert({
    where: { workspaceId: input.workspaceId },
    create: { ...input, botToken },
    update: { teamId: input.teamId, teamName: input.teamName, botToken, botUserId: input.botUserId, appId: input.appId, scopes: input.scopes, installedByUserId: input.installedByUserId },
  })
}

export async function setDefaultChannel(workspaceId: string, channelId: string, channelName: string) {
  return db.slackConnection.update({ where: { workspaceId }, data: { defaultChannelId: channelId, defaultChannelName: channelName } })
}

export async function deleteSlackConnection(workspaceId: string) {
  await db.slackConnection.deleteMany({ where: { workspaceId } })
}

/** Resolve a Slack team back to the workspace that installed it (inbound events). */
export async function getConnectionByTeam(teamId: string) {
  return db.slackConnection.findFirst({ where: { teamId } })
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: passes)

```bash
git add lib/slack/connection.ts
git commit -m "feat(slack): SlackConnection store with encrypted bot token"
```

---

## Task 6: Outbox enqueue + drain

**Files:**
- Create: `lib/slack/outbox.ts`

- [ ] **Step 1: Read the reference drain**

Read `lib/native-outbox.ts` to mirror its atomic-claim (`updateMany` guard) + retry semantics exactly.

- [ ] **Step 2: Implement**

```typescript
import { db } from '@/lib/db'
import { getDecryptedBotToken } from './connection'
import { postMessage } from './client'

const MAX_ATTEMPTS = 5

export async function enqueueSlackMessage(input: {
  workspaceId: string
  conversationId: string
  channelId: string
  threadTs: string | null
  kind: 'parent' | 'reply'
  text: string
}) {
  await db.slackOutbox.create({ data: { ...input, status: 'queued' } })
}

export async function drainSlackOutbox(opts: { limit?: number } = {}) {
  const queued = await db.slackOutbox.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 50,
  })

  for (const m of queued) {
    // Atomic claim — only one worker proceeds.
    const claim = await db.slackOutbox.updateMany({
      where: { id: m.id, status: 'queued' },
      data: { status: 'sending', attempts: { increment: 1 } },
    })
    if (claim.count === 0) continue

    try {
      const token = await getDecryptedBotToken(m.workspaceId)
      if (!token) throw new Error('no slack connection for workspace')

      const { ts } = await postMessage(token, {
        channel: m.channelId,
        text: m.text,
        thread_ts: m.threadTs ?? undefined,
      })

      await db.slackOutbox.update({ where: { id: m.id }, data: { status: 'sent', slackTs: ts, lastError: null } })

      // A parent post defines the conversation's thread root.
      if (m.kind === 'parent') {
        await db.widgetConversation.update({
          where: { id: m.conversationId },
          data: { slackChannelId: m.channelId, slackThreadTs: ts },
        }).catch(() => {})
      }
    } catch (err: any) {
      const attempts = m.attempts + 1
      const permanent = attempts >= MAX_ATTEMPTS
      await db.slackOutbox.update({
        where: { id: m.id },
        data: { status: permanent ? 'failed' : 'queued', lastError: String(err?.message ?? err).slice(0, 500) },
      })
    }
  }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: passes)

```bash
git add lib/slack/outbox.ts
git commit -m "feat(slack): outbound message queue with atomic-claim drain"
```

---

## Task 7: Bridge orchestration

**Files:**
- Create: `lib/slack/bridge.ts`

This is the heart of the feature. It decides whether a conversation is bridged, creates the parent thread lazily, mirrors messages outbound, and applies an inbound Slack reply.

- [ ] **Step 1: Implement**

```typescript
import { db } from '@/lib/db'
import { getSlackConnection } from './connection'
import { enqueueSlackMessage } from './outbox'
import { broadcast } from '@/lib/widget-sse'
import { classifySlackReply } from './parse'
import { getUserInfo } from './client'

export type BridgeMode = 'off' | 'ai_with_handoff' | 'slack_only'

export function isBridged(mode: string | null | undefined): mode is 'ai_with_handoff' | 'slack_only' {
  return mode === 'ai_with_handoff' || mode === 'slack_only'
}

/** Resolve the channel to post into: per-agent override, else workspace default. */
function resolveChannel(agent: { slackChannelId?: string | null }, conn: { defaultChannelId?: string | null }) {
  return agent.slackChannelId || conn.defaultChannelId || null
}

/**
 * Ensure a bridged conversation has a Slack thread, then mirror this
 * visitor message into it. Returns whether the AI should be suppressed
 * for this turn (true in slack_only).
 */
export async function bridgeInboundVisitorMessage(args: {
  convo: { id: string; widgetId: string; workspaceId: string; slackThreadTs: string | null; visitorName?: string | null; pageUrl?: string | null }
  agent: { slackBridgeMode: string; slackChannelId?: string | null }
  content: string
}): Promise<{ suppressAi: boolean }> {
  const mode = args.agent.slackBridgeMode
  if (!isBridged(mode)) return { suppressAi: false }

  const conn = await getSlackConnection(args.convo.workspaceId)
  if (!conn) return { suppressAi: false } // not connected → behave as off
  const channelId = resolveChannel(args.agent, conn)
  if (!channelId) return { suppressAi: false }

  if (!args.convo.slackThreadTs) {
    // Lazily create the parent. The cron writes slackThreadTs back on success.
    const header = [
      `:speech_balloon: *New chat* — ${args.convo.visitorName || 'Visitor'}`,
      args.convo.pageUrl ? `<${args.convo.pageUrl}|page>` : null,
      '',
      args.content,
    ].filter(Boolean).join('\n')
    await enqueueSlackMessage({
      workspaceId: args.convo.workspaceId, conversationId: args.convo.id,
      channelId, threadTs: null, kind: 'parent', text: header,
    })
  } else {
    await enqueueSlackMessage({
      workspaceId: args.convo.workspaceId, conversationId: args.convo.id,
      channelId, threadTs: args.convo.slackThreadTs, kind: 'reply', text: `:bust_in_silhouette: ${args.content}`,
    })
  }

  return { suppressAi: mode === 'slack_only' }
}

/** Mirror an AI reply into the thread (ai_with_handoff only; no-op if not bridged). */
export async function mirrorAgentMessage(conversationId: string, text: string) {
  const convo = await db.widgetConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, workspaceId: true, slackChannelId: true, slackThreadTs: true },
  })
  if (!convo?.slackThreadTs || !convo.slackChannelId) return
  await enqueueSlackMessage({
    workspaceId: convo.workspaceId, conversationId: convo.id,
    channelId: convo.slackChannelId, threadTs: convo.slackThreadTs, kind: 'reply', text: `:robot_face: ${text}`,
  })
}

/**
 * Apply a human's Slack thread reply to the widget conversation:
 * public → WidgetMessage + handoff + SSE; internal (!) → ConversationNote.
 */
export async function applySlackReply(args: {
  conversationId: string
  slackUserId: string
  botToken: string
  rawText: string
}) {
  const { visibility, text } = classifySlackReply(args.rawText)
  if (!text) return

  // Resolve operator: Slack email → workspace user.
  let sentByUserId: string | null = null
  let displayName = 'Support'
  try {
    const info = await getUserInfo(args.botToken, args.slackUserId)
    displayName = info.displayName
    if (info.email) {
      const user = await db.user.findUnique({ where: { email: info.email }, select: { id: true } })
      sentByUserId = user?.id ?? null
    }
  } catch { /* fall back to Slack display name */ }

  if (visibility === 'internal') {
    await db.conversationNote.create({
      data: { conversationId: args.conversationId, authorUserId: sentByUserId, body: text },
    })
    return
  }

  const msg = await db.widgetMessage.create({
    data: { conversationId: args.conversationId, role: 'agent', content: text, kind: 'text', sentByUserId },
  })
  await db.widgetConversation.update({
    where: { id: args.conversationId },
    data: { status: 'handed_off', lastMessageAt: new Date() },
  })
  // Pause the AI's formal state machine too (mirror the inbox takeover path).
  await db.conversationStateRecord.updateMany({
    where: { conversationId: args.conversationId },
    data: { state: 'PAUSED' },
  }).catch(() => {})

  await broadcast(args.conversationId, {
    type: 'agent_message',
    id: msg.id,
    content: text,
    createdAt: msg.createdAt.toISOString(),
    fromHuman: true,
    operatorName: displayName,
  })
}
```

> **Note for the implementer:** verify the exact field names when you reach this task — `WidgetConversation.workspaceId` may be reached via `widget.workspaceId` (the runner loads `convo.widget.workspaceId`). Adjust the `select`/relation accordingly. Confirm `ConversationStateRecord` has a `conversationId` column (Task uses `updateMany` by it); if it is keyed by `(agentId, locationId, contactId)` instead, pause via that key using the values the runner already computes. Confirm the `broadcast` payload type permits `operatorName` (extend the SSE event type if needed, mirroring the existing `fromHuman` flag).

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: passes (fix relation/field mismatches surfaced here).

```bash
git add lib/slack/bridge.ts
git commit -m "feat(slack): bridge orchestration (thread create, mirror, apply reply)"
```

---

## Task 8: Wire inbound visitor messages into the bridge

**Files:**
- Modify: `lib/widget-agent-runner.ts`

- [ ] **Step 1: Suppress AI / mirror visitor message after agent resolution**

In `runWidgetAgent`, after the `agent` is resolved and BEFORE the `shouldAgentReply` gate (so visitor messages still forward to Slack while handed off), insert:

```typescript
import { bridgeInboundVisitorMessage, isBridged } from '@/lib/slack/bridge'

// ... after `agent` is resolved and non-null:
const { suppressAi } = await bridgeInboundVisitorMessage({
  convo: {
    id: convo.id,
    widgetId: convo.widgetId,
    workspaceId: convo.widget.workspaceId,
    slackThreadTs: convo.slackThreadTs,
    visitorName: (convo.visitor as any)?.name ?? null,
    pageUrl: (convo as any)?.pageUrl ?? null,
  },
  agent: { slackBridgeMode: agent.slackBridgeMode, slackChannelId: agent.slackChannelId },
  content,
}).catch((e) => { console.warn('[slack] bridge inbound failed:', e?.message); return { suppressAi: false } })

if (suppressAi) {
  await broadcast(convo.id, { type: 'agent_typing', isTyping: false }).catch(() => {})
  return // slack_only: a human in Slack answers; the AI never runs.
}
```

> Confirm `convo` is loaded with `slackThreadTs` and `widget.workspaceId`. If the runner's `convo` select/include omits the new columns, widen the query that loads `convo` (search the callers — `app/api/widget/.../messages/route.ts` passes `convo`; ensure that query selects `slackThreadTs`, `slackChannelId`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add lib/widget-agent-runner.ts app/api/widget
git commit -m "feat(slack): bridge inbound visitor messages; suppress AI in slack_only"
```

---

## Task 9: Mirror AI replies into the thread

**Files:**
- Modify: `lib/widget-adapter.ts`

- [ ] **Step 1: After the agent message is created + broadcast, mirror to Slack**

In `WidgetAdapter.sendMessage`, after the existing `broadcast(...)` for the agent message, add:

```typescript
import { mirrorAgentMessage } from '@/lib/slack/bridge'

// after broadcast of the agent text message:
mirrorAgentMessage(this.conversationId, finalMessage).catch((e) =>
  console.warn('[slack] mirror agent message failed:', e?.message),
)
```

(Use the same cleaned `finalMessage` string that was persisted. `mirrorAgentMessage` is a no-op unless the conversation already has a `slackThreadTs`, so it only fires for bridged `ai_with_handoff` conversations.)

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: passes)

```bash
git add lib/widget-adapter.ts
git commit -m "feat(slack): mirror AI replies into the conversation's Slack thread"
```

---

## Task 10: OAuth install + callback routes

**Files:**
- Create: `app/api/integrations/slack/install/route.ts`
- Create: `app/api/integrations/slack/callback/route.ts`

- [ ] **Step 1: Install route (redirect to Slack)**

Read an existing authed route (e.g. under `app/api/workspaces/[workspaceId]/...`) to copy the `auth()` + workspace-membership check pattern. Then:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const SCOPES = ['chat:write','channels:read','channels:history','groups:history','team:read','users:read','users:read.email'].join(',')

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  // TODO(implementer): assert the session user is a member of workspaceId (copy the existing membership guard).

  const clientId = process.env.SLACK_CLIENT_ID!
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/api/integrations/slack/callback`
  const state = workspaceId // sufficient: re-checked against session membership on callback
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  return NextResponse.redirect(url.toString())
}
```

- [ ] **Step 2: Callback route (exchange + persist)**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { exchangeOAuthCode } from '@/lib/slack/client'
import { upsertSlackConnection } from '@/lib/slack/connection'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const code = req.nextUrl.searchParams.get('code')
  const workspaceId = req.nextUrl.searchParams.get('state')
  if (!code || !workspaceId) return NextResponse.json({ error: 'missing code/state' }, { status: 400 })
  // TODO(implementer): assert session user is a member of workspaceId before persisting.

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/api/integrations/slack/callback`
  const inst = await exchangeOAuthCode({
    code, clientId: process.env.SLACK_CLIENT_ID!, clientSecret: process.env.SLACK_CLIENT_SECRET!, redirectUri,
  })
  await upsertSlackConnection({
    workspaceId, teamId: inst.teamId, teamName: inst.teamName,
    botToken: inst.botToken, botUserId: inst.botUserId, appId: inst.appId, scopes: inst.scopes,
    installedByUserId: (session.user as any).id,
  })
  return NextResponse.redirect(`${req.nextUrl.origin}/dashboard/${workspaceId}/integrations/slack?connected=1`)
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: passes)

```bash
git add app/api/integrations/slack/install app/api/integrations/slack/callback
git commit -m "feat(slack): OAuth install + callback routes"
```

---

## Task 11: Slack Events route (inbound)

**Files:**
- Create: `app/api/integrations/slack/events/route.ts`

- [ ] **Step 1: Implement**

```typescript
import { NextRequest, NextResponse, after } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/signature'
import { getConnectionByTeam, getDecryptedBotToken } from '@/lib/slack/connection'
import { applySlackReply } from '@/lib/slack/bridge'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const ok = verifySlackSignature({
    secret: process.env.SLACK_SIGNING_SECRET!,
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    body: raw,
  })
  if (!ok) return NextResponse.json({ error: 'bad signature' }, { status: 401 })

  const payload = JSON.parse(raw)
  if (payload.type === 'url_verification') {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // Dedup at-least-once delivery + explicit retries.
  const eventId: string | undefined = payload.event_id
  if (eventId) {
    try {
      await db.processedSlackEvent.create({ data: { eventId } })
    } catch {
      return NextResponse.json({ ok: true }) // already processed
    }
  }

  const event = payload.event
  // Only human text replies inside a thread.
  const isThreadReply = event?.type === 'message' && event.thread_ts && event.thread_ts !== event.ts
  const isHuman = !event?.bot_id && !event?.subtype
  if (isThreadReply && isHuman) {
    after(async () => {
      try {
        const conn = await getConnectionByTeam(payload.team_id)
        if (!conn || event.user === conn.botUserId) return
        const convo = await db.widgetConversation.findFirst({
          where: { slackChannelId: event.channel, slackThreadTs: event.thread_ts },
          select: { id: true },
        })
        if (!convo) return
        const botToken = await getDecryptedBotToken(conn.workspaceId)
        if (!botToken) return
        await applySlackReply({ conversationId: convo.id, slackUserId: event.user, botToken, rawText: event.text ?? '' })
      } catch (e: any) {
        console.error('[slack] event processing failed:', e?.message)
      }
    })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Manual verification (deferred to integration test phase)**

Document in the PR: send a Slack thread reply and confirm a `WidgetMessage` is created + delivered via SSE; send a `!note` and confirm a `ConversationNote` is created and the visitor does NOT receive it. (Requires the live Slack app + env vars; see Task 14.)

- [ ] **Step 4: Commit**

```bash
git add app/api/integrations/slack/events
git commit -m "feat(slack): signature-verified Events API receiver with dedup + handoff"
```

---

## Task 12: Cron + vercel.json

**Files:**
- Create: `app/api/cron/slack-outbox/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Read an existing cron route**

Read `app/api/cron/native-outbox/route.ts` to copy the cron-auth header check (`CRON_SECRET` / `Authorization: Bearer`) and response shape.

- [ ] **Step 2: Implement the route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { drainSlackOutbox } from '@/lib/slack/outbox'

export async function GET(req: NextRequest) {
  // Copy the exact auth guard used by native-outbox (CRON_SECRET bearer check).
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  await drainSlackOutbox({ limit: 100 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Register the cron in `vercel.json`**

Add to the `crons` array (every minute, matching the native-outbox cadence):

```json
{ "path": "/api/cron/slack-outbox", "schedule": "* * * * *" }
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc --noEmit` (expected: passes)

```bash
git add app/api/cron/slack-outbox vercel.json
git commit -m "feat(slack): slack-outbox drain cron (every minute)"
```

---

## Task 13: Settings API + UI + per-agent control + NEW badge

**Files:**
- Create: `app/api/workspaces/[workspaceId]/integrations/slack/route.ts`
- Create: `app/api/workspaces/[workspaceId]/integrations/slack/channels/route.ts`
- Create: `app/dashboard/[workspaceId]/integrations/slack/page.tsx`
- Modify: per-agent settings page + `FEATURE_SHIP_DATES` + menu `<NewBadge>`

- [ ] **Step 1: Status / channel / disconnect API**

```typescript
// GET status, PATCH { defaultChannelId, defaultChannelName }, DELETE disconnect
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getSlackConnection, setDefaultChannel, deleteSlackConnection } from '@/lib/slack/connection'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth(); if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { workspaceId } = await ctx.params
  // TODO(implementer): membership guard.
  const conn = await getSlackConnection(workspaceId)
  return NextResponse.json({
    connected: !!conn,
    teamName: conn?.teamName ?? null,
    defaultChannelId: conn?.defaultChannelId ?? null,
    defaultChannelName: conn?.defaultChannelName ?? null,
  })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth(); if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { workspaceId } = await ctx.params
  const { defaultChannelId, defaultChannelName } = await req.json()
  await setDefaultChannel(workspaceId, defaultChannelId, defaultChannelName)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth(); if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { workspaceId } = await ctx.params
  await deleteSlackConnection(workspaceId)
  return NextResponse.json({ ok: true })
}
```

> Note Next 16 route signature: `params` is a `Promise`. Confirm against a neighboring route and `node_modules/next/dist/docs/` per AGENTS.md.

- [ ] **Step 2: Channels list API**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getDecryptedBotToken } from '@/lib/slack/connection'
import { listChannels } from '@/lib/slack/client'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth(); if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { workspaceId } = await ctx.params
  const token = await getDecryptedBotToken(workspaceId)
  if (!token) return NextResponse.json({ channels: [] })
  const channels = await listChannels(token)
  return NextResponse.json({ channels })
}
```

- [ ] **Step 3: Settings page**

Build `app/dashboard/[workspaceId]/integrations/slack/page.tsx` copying styling/classes from a neighboring integrations page (e.g. the Meta/Google ones). Theme tokens only — no raw Tailwind palette (see CLAUDE.md). Elements:
- If not connected: an "Add to Slack" link → `/api/integrations/slack/install?workspaceId=<id>`.
- If connected: show team name, a channel `<select>` (fetched from the channels API) bound to PATCH, and a Disconnect button (DELETE).

- [ ] **Step 4: Per-agent bridge control**

On the agent settings page (the same surface that holds other agent config), add a "Slack bridging" control with three options (Off / AI with handoff / Slack-only) writing `slackBridgeMode`, and an optional channel-override select writing `slackChannelId`. Use the `useDirtyForm` + `<SaveBar>` pattern (see the `voxility-save-refactor` skill / `voice/page.tsx`). Ensure the agent PATCH/update API persists the two new fields (widen its accepted body + Prisma `update` data).

- [ ] **Step 5: NEW badge + ship date**

Add a `FEATURE_SHIP_DATES` entry for the Slack integration and render `<NewBadge since="2026-06-17">` on the Integrations → Slack menu item (see `components/NewBadge.tsx`).

- [ ] **Step 6: Typecheck + build + commit**

Run: `npx tsc --noEmit` (expected: passes)
Run: `npm run lint` (expected: passes)

```bash
git add app/api/workspaces app/dashboard components lib
git commit -m "feat(slack): settings UI, channel picker, per-agent bridge mode, NEW badge"
```

---

## Task 14: Slack app manifest + setup doc + env vars

**Files:**
- Create: `slack/manifest.yaml`
- Create: `slack/README.md`

- [ ] **Step 1: Write the manifest**

```yaml
display_information:
  name: Voxility
  description: Bridge website chats into Slack and reply from a thread.
oauth_config:
  redirect_urls:
    - https://<APP_DOMAIN>/api/integrations/slack/callback
  scopes:
    bot:
      - chat:write
      - channels:read
      - channels:history
      - groups:history
      - team:read
      - users:read
      - users:read.email
settings:
  event_subscriptions:
    request_url: https://<APP_DOMAIN>/api/integrations/slack/events
    bot_events:
      - message.channels
      - message.groups
  org_deploy_enabled: false
  socket_mode_enabled: false
```

- [ ] **Step 2: Write `slack/README.md`**

Document: create the app from `manifest.yaml`, the redirect/event URLs, and the three required env vars `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` (plus `NEXT_PUBLIC_APP_URL` if not already set). Note that the bot must be invited to any channel used (`/invite @Voxility`).

- [ ] **Step 3: Set the env vars**

Use `printf '%s' "$VALUE" | vercel env add SLACK_CLIENT_ID production` (NOT `echo` — see CLAUDE.md). Repeat for `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, across the needed environments. (Done by the operator with real values from the created Slack app.)

- [ ] **Step 4: Commit**

```bash
git add slack
git commit -m "docs(slack): app manifest + setup README"
```

---

## Final verification (before opening a PR)

- [ ] `npx tsc --noEmit` — passes.
- [ ] `npm run test` — Slack pure-helper tests (`signature`, `parse`) pass; nothing else regresses.
- [ ] `npm run lint` — passes.
- [ ] `npm run build` — succeeds (note: the build runs `scripts/prisma-migrate.mjs`; the new migration must be present but Ryan applies prod SQL by hand).
- [ ] Manual end-to-end on a preview deploy with the live Slack app:
  - Set an agent to `slack_only`; send a widget message → it appears as a Slack thread; the AI does NOT reply.
  - Reply in the Slack thread → the reply appears in the widget (no human/AI distinction to the visitor).
  - Send `!internal note` in the thread → a `ConversationNote` is created; the visitor sees nothing.
  - Set an agent to `ai_with_handoff`; confirm the AI answers, replies mirror into the thread, and a human Slack reply pauses the AI.

---

## Self-Review notes (author)

- **Spec coverage:** every spec section maps to a task — OAuth/app (10, 14), data model (1), outbound (6, 7-mirror, 9), inbound (11, 7-apply), modes (8 suppress + 9 mirror), settings/NEW badge (13), edge cases (signature/dedup in 2/11, prefix in 3/7, identity in 7). ✅
- **Repo-specific risks flagged inline:** exact `lib/secrets.ts` export names (Task 5), `ConversationStateRecord` key shape and `convo` select widening (Tasks 7-8), Next 16 `params` Promise + route docs (Task 13), SSE event-type extension for `operatorName` (Task 7). These are the spots most likely to need a quick read of the real file during execution.
- **No unit tests for routes/Prisma** — matches `vitest.config.ts` scope; routes are verified by typecheck + the manual E2E checklist.
