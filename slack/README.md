# Slack widget-bridge — setup

Bridges widget live-chat conversations into a Slack channel. Each conversation
becomes a Slack thread; a teammate replies in the thread and the reply is
delivered into the visitor's widget (the visitor experience is unchanged). A
reply starting with `!` becomes an internal note (saved as a `ConversationNote`,
never sent to the visitor).

Design: `docs/superpowers/specs/2026-06-17-slack-widget-bridge-design.md`
Plan: `docs/superpowers/plans/2026-06-17-slack-widget-bridge.md`

## One-time app setup

1. Go to https://api.slack.com/apps → **Create New App** → **From an app manifest**.
2. Paste `slack/manifest.yaml`, replacing every `<APP_DOMAIN>` with the
   deployment host (e.g. `app.voxility.example`).
3. Install the app to your own workspace once to mint the signing secret and
   client credentials (customers install via the in-app "Add to Slack" button).
4. From **Basic Information**, copy the **Client ID**, **Client Secret**, and
   **Signing Secret**.

## Environment variables

Set these in Vercel (and `.env.local` for dev). Use `printf '%s'`, never `echo`
— `echo` appends a newline that corrupts the value:

```bash
printf '%s' "$SLACK_CLIENT_ID"     | vercel env add SLACK_CLIENT_ID production
printf '%s' "$SLACK_CLIENT_SECRET" | vercel env add SLACK_CLIENT_SECRET production
printf '%s' "$SLACK_SIGNING_SECRET"| vercel env add SLACK_SIGNING_SECRET production
```

`NEXT_PUBLIC_APP_URL` must also be set to the deployment origin (used to build
the OAuth redirect URI); if it isn't, the routes fall back to the request
origin, which is fine for single-domain deployments.

## How a workspace connects

1. Dashboard → **Integrations → Slack → Add to Slack** → authorize.
2. Pick a **default channel**.
3. In Slack, invite the bot to that channel: `/invite @Voxility`
   (the bot can only post to channels it's a member of).
4. On an agent's **Trigger** tab, set **Slack bridging**:
   - **AI with Slack handoff** — AI answers; conversations mirror into Slack and
     a human can take over by replying.
   - **Slack only** — every chat goes to Slack from the first message; a human
     answers and the AI never replies.

## Database

The migration `prisma/migrations/20260617120000_slack_widget_bridge/migration.sql`
adds `SlackConnection`, `SlackOutbox`, `ProcessedSlackEvent`, plus
`Agent.slackBridgeMode` / `Agent.slackChannelId` and
`WidgetConversation.slackChannelId` / `WidgetConversation.slackThreadTs`. It is
idempotent and applied by hand in production (per `prisma/MIGRATIONS.md`).

## Operational notes

- Outbound delivery is queued in `SlackOutbox` and drained every minute by
  `/api/cron/slack-outbox` (registered in `vercel.json`).
- Inbound events hit `/api/integrations/slack/events`, which verifies the Slack
  signature, dedupes retries via `ProcessedSlackEvent`, and acks within 3s.
- `ProcessedSlackEvent` rows can be pruned after 24h by any maintenance job.
