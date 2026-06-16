# Meeting-bot screen-share vision (v1) — design

**Date:** 2026-06-16
**Status:** Approved design, pre-implementation
**Scope:** Let the Recall.ai meeting bot (Google Meet / Zoom / Teams) SEE a participant's shared
screen and feed those frames to its live Gemini session, so it can guide on what's on screen —
not just on audio.

## Context & problem

The meeting bot today **hears but cannot see**. It uses Recall's Output Media "webpage" mode:
Recall loads our page (`app/copilot/bot/[botToken]/page.tsx`) in the bot's headless browser; the
page's microphone IS the meeting's mixed audio, and the page's render + audio output ARE the bot's
camera tile and voice. The Gemini Live session runs **inside that page** (browser-direct, same
stack as the in-app co-pilot). Meeting audio already streams to Gemini via
`provider.sendAudioChunk()`. But **no video of any kind reaches the page** — no camera feeds, no
screen shares — so when someone shares their screen on a Meet call, the bot has nothing to look at.
`buildMeetingPrompt` even hard-codes "YOU CANNOT SEE ANYTHING" so the model doesn't bluff.

The blocker is structural: to receive a meeting's live video you need Recall's **real-time video
websocket**, which is a **push** model — Recall connects out to a public `wss://` URL you host and
streams frames to it. Vercel (where `ghl-agent` deploys) cannot host a persistent websocket
receiver. So a small always-on service is genuinely required; that service is this project.

**Goal:** on a real Google Meet, a participant shares their screen and the bot references what's on
it in real time ("you're on the integrations page — click Connect next to your CRM"), while audio,
voice, and the bot tile keep working exactly as today.

## Non-goals (v1)

- **Reading fine print.** Success bar is *general awareness* (what app/page/screen is shared), not
  reading small text/field values. Recall real-time video is ~360p PNG @ ~2fps; that's the target.
- **Seeing participant cameras / faces.** We forward only the screenshare track — privacy and
  relevance. Camera frames are dropped.
- **Re-architecting the meeting stack.** Gemini stays in the bot page (see "Approach" below).
- **A `take_a_closer_look` equivalent for meetings.** Frames are a ~2fps push stream; no on-demand
  high-res capture in v1.

## Approach

**Chosen: A — thin relay worker; Gemini stays in the bot page.**
A new tiny Fly.io websocket service receives Recall's screenshare frames and forwards them into the
bot's existing headless page, which already runs Gemini and pipes audio both ways. One new socket on
each side + a prompt flip. Small, isolated, and nothing in the existing audio/Gemini/bot-tile path
changes.

**Rejected for v1: B — full headless worker.** Move Gemini out of the browser into the worker;
worker ingests Recall audio+video and pipes Gemini's voice back via Recall output-audio, eliminating
the headless browser. This is a ground-up rewrite of the meeting stack and depends on Recall
output-audio streaming — disproportionate risk for the goal. Revisit only if the browser path proves
flaky at scale.

## Architecture

```
Google Meet ──┬─ audio ────────→ bot page mic ─→ Gemini                 (EXISTING)
              └─ screenshare ──→ Recall realtime_endpoint (push)
                       └─→ worker  /recall/:botToken   (ingest socket)
                              └─→ worker  /agent/:botToken  (relay socket)
                                     └─→ bot page → provider.sendVideoFrame() → Gemini   (NEW)
Gemini voice ───────────────────→ bot page PcmPlayer ─→ bot audio ─→ Meet (EXISTING)
```

### New component: `recall-video-worker` (Fly.io, standalone Node)

A single small service with one job and a clean socket contract. Two socket roles, paired by
`botToken` (the existing 24-byte random capability token minted per meeting session in
`session-service.ts`):

- **Ingest — `wss://<worker>/recall/:botToken`** (public; Recall connects out to it).
  Subscribed Recall events: `video_separate_png.data` (per-participant PNG frames) and
  `participant_events.*` (to detect screenshare start/stop and which participant is sharing).
- **Relay — `wss://<worker>/agent/:botToken`** (the bot page connects in).
  The worker forwards **only the screenshare participant's** frames down this socket.

**Core logic (pure, unit-testable):** maintain per-`botToken` room state = which participant id is
currently screensharing (from `participant_events`). For each incoming `video_separate_png.data`,
forward it to the room's relay socket **iff** its participant id is the active screenshare; else
drop. Light dedupe: skip a frame identical to the immediately previous forwarded one. No transcode
in v1 (pass PNG through; Gemini accepts PNG).

**State:** in-memory `Map<botToken, Room>` where `Room = { recallSocket?, agentSocket?,
screensharingParticipantId?, lastFrameHash? }`. No DB, no durable state. A restart drops rooms;
both sides reconnect with backoff and re-pair by `botToken`. One small instance handles many
concurrent meetings.

### Changes in `ghl-agent`

1. **`lib/copilot/recall.ts`** — in the create-bot payload add:
   ```jsonc
   "recording_config": {
     "realtime_endpoints": [{
       "type": "websocket",
       "url": "wss://<RECALL_VIDEO_WORKER_WS_HOST>/recall/<botToken>",
       "events": ["video_separate_png.data", "participant_events"]
     }]
   }
   ```
   New env `RECALL_VIDEO_WORKER_WS_HOST` (e.g. `voxility-recall-worker.fly.dev`). If unset, omit the
   endpoint entirely — the bot still joins and works audio-only (feature flag by env presence).
   *(Exact Recall event-name strings + `recording_config` shape to be confirmed against Recall docs
   during implementation; the realtime_endpoints push pattern itself is confirmed.)*

2. **`app/copilot/bot/[botToken]/page.tsx`** — after `provider.connect(...)` succeeds, open the relay
   socket to `wss://<worker>/agent/<botToken>`; on each frame message →
   `providerRef.current?.sendVideoFrame(pngBase64)`. Reconnect with capped backoff while the session
   is live; close on session end. The worker host comes from the connect response (server passes it
   from env) so the client holds no config.

3. **`lib/copilot/providers/gemini-live.ts`** — `sendVideoFrame` currently hardcodes
   `mimeType: 'image/jpeg'`. Accept PNG: add an optional `mimeType` param (default keeps existing
   JPEG callers unchanged) so the bot page can send `image/png`.

4. **`lib/copilot/prompt.ts` → `buildMeetingPrompt`** — replace the absolute "YOU CANNOT SEE
   ANYTHING" rule with screenshare-aware guidance: *you can see a participant's **shared screen**
   when they share it (never their cameras); the view is low-resolution and ~2 fps, so guide on
   what app/page/section is shown rather than reading fine print; if no one is sharing you see
   nothing — ask them to share their screen.* Keep it honest about not pretending to see when no
   share is active.

### Socket message contracts (worker)

- **Recall → worker (ingest):** Recall real-time websocket JSON payloads. Expected: a
  `video_separate_png.data` event carrying participant identity + base64 PNG buffer + timestamp, and
  `participant_events` carrying screenshare start/stop with participant id. Worker tolerates unknown
  event types (ignore). Exact field paths verified against Recall docs in the implementation plan.
- **Worker → bot page (relay):** minimal envelope, our own shape we control:
  ```jsonc
  { "type": "frame", "mime": "image/png", "data": "<base64>", "ts": 1718500000000 }
  { "type": "screenshare", "active": false }   // optional: tell page sharing stopped
  ```
- The bot page → worker only needs to open the socket on the right path; no upstream messages
  required in v1 (a `hello`/ping is allowed for keepalive).

## Security

- `botToken` is an unguessable 24-byte random capability token, already scoped per session and
  short-lived. It is the room key embedded in both socket paths; the worker pairs ingest↔relay by it.
- v1 treats `botToken` as a bearer. Hardening (optional, can land in v1 if cheap): the worker
  validates `botToken` against a tiny `ghl-agent` endpoint (e.g. `GET /api/copilot/meeting/:botToken/exists`)
  before accepting a relay socket, so stale/forged tokens can't open rooms.
- Recall→worker is unauthenticated by Recall; the token-in-path is the guard. Optionally add a static
  shared `?key=` the worker checks, set in the realtime_endpoint URL.
- The worker stores nothing durable and logs no frame contents.

## Failure handling (graceful degradation is the theme)

- **Worker unreachable / down, or no one sharing:** the page never calls `sendVideoFrame`, so the bot
  behaves exactly like today (audio-only); the prompt tells it to ask the user to share.
- **Screenshare stops:** worker stops forwarding (and may send `screenshare:false`); the model
  notices frames stopped.
- **Reconnects:** both sockets reconnect with capped exponential backoff; re-paired by `botToken`.
- **Worker restart:** in-memory rooms drop; reconnects rebuild them. No data loss that matters.
- **`RECALL_VIDEO_WORKER_WS_HOST` unset:** feature off; bots run audio-only (safe default / kill switch).

## Testing

- **Unit (worker):** the forward-decision is a pure function — given a sequence of
  `participant_events` + `video_separate_png` payloads, assert exactly the screenshare frames are
  emitted, camera frames dropped, dedupe works, and start/stop toggles routing.
- **Integration (worker):** a mock Recall client replays a captured event/frame sequence into the
  ingest socket; a mock bot-page client asserts the relayed frames. No real Recall needed.
- **Contract:** a small fixture of real Recall payloads (captured once) pins the field paths the
  worker reads, so a Recall format change fails loudly.
- **E2E:** real Google Meet — bot joins, a participant shares a screen, confirm via the session
  transcript/telemetry that the bot references on-screen content and that audio/voice/tile are
  unaffected. Also confirm audio-only still works with the worker env unset.

## Deployment & ops

- **Worker:** new directory `recall-video-worker/` (own `package.json`, `fly.toml`, `Dockerfile`,
  Node `ws` server). Deployed to Fly.io as a single small always-on machine; public `wss://`.
- **`ghl-agent` env:** add `RECALL_VIDEO_WORKER_WS_HOST` (prod + dev). Redeploy needed (Recall payload
  is built at bot-create time).
- **Naming:** brand-neutral, no `ghl`/`HighLevel` — `recall-video-worker`, `voxility-recall-worker`.

## Risks / open items (resolve during planning, not blockers)

- **Exact Recall payload shapes** (`video_separate_png.data` field names, how screenshare is flagged
  in `participant_events`, base64 vs binary frames) — confirm against Recall docs + a captured
  fixture early in implementation.
- **Resolution reality:** if 360p proves too coarse even for general awareness, check whether Recall
  exposes a higher-res video option; out of scope to force it in v1.
- **Fly single-instance scaling:** fine for current volume; if many concurrent meetings, add
  `botToken`-sticky routing later. Not a v1 concern.

## Out of scope (future)

- Higher-resolution / on-demand "closer look" for meetings.
- Headless worker that fully replaces the bot browser (Approach B).
- Seeing participant cameras; multi-sharer disambiguation beyond "current screenshare participant".
