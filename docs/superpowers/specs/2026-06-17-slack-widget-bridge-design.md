# Slack Bridge for Widget Conversations — Design

**Date:** 2026-06-17
**Branch:** `slack-widget-bridge`
**Status:** Approved design, pre-implementation

## Goal

Let a widget conversation be **bridged to Slack**: each conversation becomes a
thread in a chosen Slack channel, a human replies in that thread, and the reply
is delivered into the visitor's widget as if it came from the agent. The
visitor's experience is unchanged — same SSE stream, same "agent is typing", no
indication a human in Slack is on the other end.

This reuses Voxility's existing handoff machinery:

- `WidgetConversation.status = 'handed_off'` pauses the AI.
- `broadcast()` + SSE (`lib/widget-pubsub.ts`) delivers a message to the widget.
- `fromHuman: true` in the SSE payload flags a human-origin message for the widget UI.
- `WidgetMessage.sentByUserId` (in-flight WIP on this branch) persists operator identity.

The genuinely new part is the **return path from Slack**, which requires a real
Slack App (bot token + Events API), not the existing one-way incoming webhook
used by `NotificationChannel`.

## Modes (per agent)

A `slackBridgeMode` field on the `Agent` model. Each `WidgetConversation`
already carries an `agentId`, so mode is resolved per conversation.

- **`slack_only`** — from the first visitor message the conversation is bridged;
  the AI never runs. Slack is the agent.
- **`ai_with_handoff`** — the AI answers normally; the conversation is also
  mirrored into a Slack thread so an operator can take over at any time by
  replying (which pauses the AI). AI replies are mirrored into the thread for
  operator context (see Open Question: noise toggle).
- **`off`** — current behavior. Default. Nothing changes.

## Components

### 1. Slack App + OAuth (one shared Voxility app)

- A single Slack app; manifest generated and committed to the repo.
- Bot scopes: `chat:write`, `channels:read`, `channels:history`,
  `groups:history`, `team:read`, `users:read`, `users:read.email`.
- Events API subscriptions: `message.channels`, `message.groups`.
- "Add to Slack" OAuth button in workspace settings → redirect → callback
  exchanges the code and stores the install.
- New env vars (generated/registered as part of shipping):
  `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.

### 2. Data model

New model **`SlackConnection`** (workspace-scoped, unique per workspace):

- `workspaceId` (unique), `teamId`, `teamName`
- `botToken` (encrypted via `lib/secrets.ts`), `botUserId`, `appId`, `scopes`
- `defaultChannelId`, `defaultChannelName`
- `installedByUserId`, `createdAt`, `updatedAt`

New model **`SlackOutbox`** (outbound delivery queue, mirrors `NativeMessage`):

- `id`, `workspaceId`, `conversationId`
- `channelId`, `threadTs?` (null = this row creates the parent message)
- `text`, `blocks?` (Json)
- `kind` (`parent` | `reply`)
- `status` (`queued` | `sending` | `sent` | `failed`), `attempts`, `lastError?`
- `slackTs?` (the ts returned by Slack on success; used to learn the thread root)
- `createdAt`, `updatedAt`

New model **`ProcessedSlackEvent`** (inbound dedupe):

- `eventId` (unique), `createdAt`. Periodically pruned by an existing maintenance
  cron (rows older than 24h).

`Agent` additions:

- `slackBridgeMode` String @default("off")
- `slackChannelId` String?  (per-agent channel override; falls back to
  `SlackConnection.defaultChannelId`)

`WidgetConversation` additions:

- `slackChannelId` String?
- `slackThreadTs` String?

All migrations are authored as SQL and applied by hand in production (Ryan's
workflow). The build never auto-runs them.

### 3. Outbound: widget → Slack (`lib/slack/bridge.ts` + cron)

- `ensureSlackThread(conversation)` — if the conversation should be bridged and
  has no `slackThreadTs`, enqueue a `SlackOutbox` row with `kind='parent'`
  carrying a header (visitor name / page URL / first message).
- `mirrorToSlack(conversation, message)` — enqueue a `kind='reply'` row for each
  subsequent visitor message (and, in `ai_with_handoff`, each AI reply) so the
  operator sees the running conversation.
- Drain via new cron `/api/cron/slack-outbox` (every minute, added to
  `vercel.json`), mirroring `lib/native-outbox.ts`:
  - atomic claim `queued → sending` via `updateMany` guard,
  - `chat.postMessage` (parent: no `thread_ts`; reply: with the conversation's
    `slackThreadTs`),
  - on a `parent` success, write the returned `ts` back to
    `WidgetConversation.slackThreadTs` + `slackChannelId`,
  - transient error → leave `queued`/bump attempts; permanent → `failed`.

### 4. Inbound: Slack → widget (`/api/integrations/slack/events`)

Public route (no session), CRM-neutral path (never `ghl`):

- Verify the Slack signing secret (`v0` HMAC over
  `v0:{timestamp}:{rawBody}`); reject stale timestamps (>5 min).
- Handle the `url_verification` challenge.
- Dedupe on `event_id` via `ProcessedSlackEvent`; also honor the
  `X-Slack-Retry-Num` header. Return `200` immediately, do work in `after()`
  (Slack's 3-second ack rule).
- For a `message` event with a `thread_ts`:
  - ignore the bot's own messages (`bot_id`, or `user === botUserId`), and
    message subtypes that aren't human text (edits, joins, etc.),
  - resolve the `WidgetConversation` by `(channel, thread_ts)`,
  - if the text starts with **`!`** → strip the marker, save a
    `ConversationNote` (internal; visitor never sees it),
  - otherwise → create a `WidgetMessage` (`role='agent'`,
    `sentByUserId` = resolved operator), set the conversation
    `status='handed_off'`, pause the AI via `ConversationStateRecord`
    (`PAUSED`), and `broadcast()` to the widget with `fromHuman: true` and the
    operator's display name.
- Operator resolution: Slack `users.info` email → `WorkspaceMember`/`User` by
  email; fall back to the Slack display name (stored on the broadcast only, not
  a fabricated user).

### 5. Settings UI + NEW badge

- Workspace **Integrations → Slack** page: "Add to Slack", connection status,
  default-channel picker (`conversations.list`), disconnect.
- Per-agent control: "Slack bridging" (off / AI with handoff / Slack-only) +
  optional channel override, using the `useDirtyForm` + `<SaveBar>` pattern.
- `<NewBadge since="2026-06-17">` + a `FEATURE_SHIP_DATES` entry, in the same PR.

## Edge cases handled

- **Slack retries / at-least-once delivery** — `ProcessedSlackEvent` dedupe.
- **Bot loop** — ignore messages authored by `botUserId`.
- **3-second ack** — return `200` synchronously, process in `after()`.
- **Concurrent conversations** — thread isolation via `(channel, thread_ts)`.
- **Accidental internal leak** — `!` prefix routes to `ConversationNote`.
- **Operator identity** — email match → member; else Slack display name only.
- **Out-of-order typing** — visitor messages mirror into the thread in arrival
  order via the outbox queue.
- **Slack API latency/failure** — decoupled from the visitor request path by the
  outbox + cron.

## Out of scope (YAGNI for v1)

- Editing/deleting a Slack message reflecting back to the widget.
- File/image attachments from Slack → widget (visitor → Slack images still
  mirror as links).
- Slack slash-commands or interactive Block Kit controls (assign, resolve).
  Handoff state is driven implicitly by replying.
- Multi-channel routing rules beyond per-agent channel override.

## Open questions (default chosen, revisit if needed)

1. **`ai_with_handoff` noise** — default mirrors AI replies into the thread for
   context. If high-volume widgets make channels noisy, gate AI-reply mirroring
   behind a per-agent toggle. Not built in v1.

## Dependencies / sequencing notes

- Builds on the in-flight `WidgetMessage.sentByUserId` work already present on
  this branch (migration `20260617000000_widget_message_author`).
- New env vars must exist before the OAuth callback and events route work in any
  deployed environment.
