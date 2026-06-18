# Gemini Voice Agents — Design

**Date:** 2026-06-18
**Status:** Approved shape, pending spec review
**Author:** Ryan + Claude

## Problem

Gemini's native-audio voice model sounds materially more human than the
TTS-pipeline voices we ship today (Vapi-native, ElevenLabs). Operators
want to choose Gemini for a voice agent and have it answer on both the
**phone** and in the **browser** with that same native quality.

The "human" quality comes specifically from Gemini Live being a *native
speech-to-speech* model — one model hears and speaks audio directly,
rather than STT → LLM → TTS stitched together. Any design that reduces
Gemini to a TTS voice inside the existing Vapi pipeline fails the goal.

## Key constraints discovered

1. **Vapi has no native Gemini speech-to-speech.** Vapi only runs Gemini
   as the LLM inside its STT→LLM→TTS pipeline. Confirmed against Vapi's
   own docs/blog. So "Gemini on the phone" cannot be a Vapi config flip.

2. **Native phone audio needs a long-lived media relay.** The reference
   pattern (multiple Google/Twilio implementations) is: Twilio Media
   Streams ↔ a WebSocket relay ↔ Gemini Live, transcoding G.711 μ-law
   8 kHz ↔ PCM 16/24 kHz. The relay holds a socket open for the whole
   call. **Vercel serverless cannot host this** — no raw WebSocket
   server, function time limits. This is the one piece that must live
   off-Vercel.

3. **The web path has no infra problem.** The browser talks to Gemini
   Live directly over WebSocket, exactly like the existing Copilot
   (`lib/copilot/providers/gemini-live.ts`). Auth is an ephemeral Google
   token minted server-side; the session config/tools are locked into
   the token so the client can't tamper.

4. **Gemini is a different *runtime*, not a Vapi engine.** In the current
   code, engine choice (`vapi` vs `elevenlabs`) is a property of the Vapi
   assistant's `voice` block — Vapi is the runtime in both cases
   (`lib/voice/vapi-adapter.ts`). Gemini bypasses Vapi entirely. It must
   sit at a level *above* the Vapi engine switch, not inside
   `buildVapiVoiceBlock`.

## Decisions

- **Voice runtime is a new top-level dimension on a voice agent:**
  `vapi` (today's telephony pipeline, sub-engine vapi-native/elevenlabs)
  vs `gemini` (native speech-to-speech, web + phone).
- **Phone media bridge = Node/TS service on Fly.io** (existing infra —
  we already operate Fly.io, so this is no net-new platform). Twilio
  `<Connect><Stream>` → Fly WebSocket server holds the per-call socket and
  proxies audio ↔ Gemini Live, transcoding G.711 μ-law 8 kHz ↔ PCM. Pinned
  to `nrt` (Tokyo — Fly's closest region to the Seoul DB) for latency. Fly
  Machines auto-suspend to zero when idle and wake on inbound call (keep
  `min_machines_running=1` if instant first-call answer matters more than
  shaving idle cost). **Twilio (not Vapi) is the carrier for Gemini phone
  agents.** Existing Vapi agents are completely untouched.
  - *Rejected alternatives:* Cloudflare Durable Object (net-new platform);
    managed realtime-voice platforms Pipecat Cloud / LiveKit Cloud (new
    per-minute vendor + Python or a re-introduction of LiveKit, which was
    deliberately avoided for the Copilot browser path). Fly wins purely
    because it's already in the stack and keeps the bridge in TypeScript.
- **Gemini config is a sibling table** (`GeminiVoiceConfig`), not nullable
  columns bolted onto `VapiConfig`. VapiConfig is Vapi-specific
  (`vapiAssistantId`, ElevenLabs tuning, Vapi phone numbers); overloading
  it would tangle two runtimes.
- **Reuse, don't fork, the Gemini Live session logic.** The session
  config builder (system instruction from the agent's prompt/knowledge,
  tool declarations, voice selection, `liveConnectConstraints`) is
  factored into a shared module used by both the web token route and the
  phone bridge.
- **Target model: Gemini 3.1 Flash Live** — the single audio-to-audio
  model Google consolidated the native-audio + half-cascade paths into
  (March 2026). Env-overridable (`GEMINI_VOICE_MODEL`). Same model on web
  and phone so the two surfaces sound identical.
- **One feature, shipped together (not phased):** web + phone land in one
  push behind the same provider picker, since the Fly.io bridge is
  existing infra and adds no platform risk. Internally the web seam is
  built and verifiable first, but both ship in the same feature branch.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │  Vercel app (control plane, unchanged    │
                    │  region pin icn1 / Seoul)                │
                    │                                          │
  voice page  ───►  │  GeminiVoiceConfig (Prisma)              │
  (provider          │  /api/.../gemini-voice  (GET/PUT config)│
   picker)           │  buildGeminiSession()  (shared)         │
                    │  /api/.../gemini-voice/token (web mint)  │
                    │  /api/voice/gemini/twilio (TwiML answer) │
                    │  /api/voice/gemini/bridge-auth (signed)  │
                    │  transcript persistence (webhook sink)   │
                    └───────┬──────────────────────┬───────────┘
                            │ web                   │ phone
          ephemeral token + │ session cfg           │ signed session cfg
                            ▼                       ▼
                  ┌──────────────────┐   ┌────────────────────────────┐
                  │ Browser          │   │ Fly.io Node/TS bridge       │
                  │ GeminiLive       │   │ (existing infra, nrt/Tokyo) │
                  │ provider (reuse  │   │  Twilio Media Streams ↔     │
                  │ copilot class)   │   │  Gemini Live, μ-law↔PCM     │
                  └────────┬─────────┘   └──────────┬──────────────────┘
                           │                        │
                           ▼                        ▼
                     Gemini Live API          Gemini Live API
                                                    ▲
                                              Twilio number
                                              (PSTN carrier)
```

## Components

### 1. Data model — `GeminiVoiceConfig` (Prisma)

Sibling to `VapiConfig`, 1:1 on `Agent`. Fields (initial):

- `agentId` (unique FK), `isActive`
- `voiceName` — Gemini prebuilt voice id (e.g. `Puck`, `Charon`, `Kore`,
  `Aoede`). Catalogue served by a small static list like
  `vapi-native-voices.ts`.
- `model` — Gemini native-audio model id, env-overridable
  (`GEMINI_VOICE_MODEL`), default `gemini-3.1-flash-live` (the
  consolidated audio-to-audio model).
- `firstMessage`, `endCallMessage` — reuse merge-field helpers from the
  Vapi voice page.
- `maxDurationSecs` (default 600, mirrors Copilot ceiling), `recordCalls`,
  `language`.
- **Phone:** `twilioNumberSid`, `twilioNumber` (E.164). Provisioned via
  Twilio, not Vapi.
- `createdAt`, `updatedAt`.

Agent gains a `voiceRuntime String? @default("vapi")` discriminator
(`'vapi' | 'gemini'`) so the dashboard and any inbound router know which
config table is authoritative. (Alternative considered: derive from which
config row `isActive`. Rejected — an explicit discriminator avoids
ambiguity when both rows exist.)

Migration is **hand-run SQL** (per project rule — Ryan applies all SQL by
hand). Feature ships on a branch; SQL runs before merge to main.

### 2. Shared session builder — `lib/voice/gemini/session.ts`

`buildGeminiSession(agent, config)` → the Gemini Live setup payload:
system instruction (agent prompt + knowledge + brand-neutral guardrails),
tool declarations (mapped from the agent's CRM tool catalogue, same
source the Vapi/agent runtime uses), selected voice, language, and the
`liveConnectConstraints` that lock model/voice/tools so neither the
browser nor the bridge can escalate. This is the single source of truth
both runtimes consume — no divergence between web and phone behaviour.

Tool execution reuses the existing agent executor (`executeTool` →
`CrmAdapter`). Tool *calls* arrive from Gemini; both runtimes post them to
a server endpoint that runs the real executor and returns results — the
browser/bridge never touches CRM credentials directly. (Mirrors the
Copilot `onToolCall` → backend pattern.)

### 3. Web runtime

- **Token route** `/api/workspaces/.../agents/.../gemini-voice/token`
  mints an ephemeral Google token with the locked session config, exactly
  like `/api/copilot/sessions`. Gated by `requireWorkspaceAccess` for the
  dashboard preview; the public widget path gets its own scoped,
  rate-limited mint (reuse Copilot demo abuse guards: concurrency cap +
  per-IP live-session limit).
- **Client** reuses `GeminiLiveProvider` from `lib/copilot/providers/`.
  The customer-facing surface is a voice call panel in the chat widget
  (mic + speaker), and a "Test voice" button on the dashboard voice page.
- Transcripts stream to a session row and persist on end (reuse the
  Conversation/transcript shape used by widget chats so live-chat inbox
  and portal transcripts render Gemini voice calls with no special-casing;
  AI-vs-human iconography already exists from S416).

### 4. Phone runtime (Fly.io Node/TS bridge)

- **Twilio number** provisioned per agent (new Twilio client in
  `lib/voice/gemini/twilio.ts`; secrets generated by us, stored via
  `printf | vercel env add`).
- **Inbound answer:** Twilio hits `/api/voice/gemini/twilio` (TwiML),
  which returns `<Connect><Stream url="wss://<bridge>.fly.dev/call">` with
  a short-lived **signed** params blob (HMAC) identifying the agent +
  carrying the session config reference. Vercel serves this — it's a
  normal request/response, no socket.
- **Bridge (Fly.io):** a small Node/TypeScript WebSocket server. Per call
  it: verifies the HMAC params (shared secret, verified locally — no
  round-trip needed), fetches the locked session config (calls Vercel
  `/api/voice/gemini/session-config` once with the signed ref, or reads it
  from the params blob), opens a Gemini Live socket via the shared
  `buildGeminiSession` logic (the bridge imports the same builder — see
  note below), and relays audio both ways with G.711 μ-law 8 kHz ↔ PCM
  transcoding and barge-in/interrupt handling. Tool calls round-trip to
  the Vercel tool-exec endpoint. On call end it POSTs the transcript +
  duration to a Vercel webhook sink for persistence.
- **Bridge repo:** lives under `ghl-agent/services/gemini-voice-bridge/`
  with its own `package.json` + `fly.toml`, deployed to Fly.io (region
  `nrt`/Tokyo), **not** Vercel. It is a standalone Node service, not part
  of the Next build. Fly Machines auto-stop/auto-start so idle calls cost
  nothing; set `min_machines_running=1` if instant first-call answer is
  required.
- **Sharing the session builder across two runtimes/repos:** `lib/voice/gemini/session.ts`
  is written runtime-agnostic (pure function, no Next/Prisma imports) so
  the Fly bridge can depend on it directly via a path/workspace import, or
  the bridge calls the Vercel `session-config` endpoint that wraps it.
  Plan picks one; the function stays the single source of truth either way.
- **Naming:** all new identifiers use `gemini`/`voice`/generic CRM terms —
  no `ghl`/`HighLevel` (project rule).

### 5. Dashboard UI — voice page

`app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx` gains a
**runtime picker at the top**: "Standard (phone, Vapi)" vs
"Gemini — native voice (most human)". Selecting Gemini swaps the panel to
Gemini config (voice catalogue with preview, first/end message, Twilio
number, advanced). The page already uses (or is being ported to) the
`useDirtyForm` + `<SaveBar>` pattern — Gemini fields participate in the
same dirty tracking; **use the `voxility-save-refactor` skill** if this
page is still on the legacy inline-save button.

A `<NewBadge since="2026-06-...">` ships on the Gemini option + a
`FEATURE_SHIP_DATES` entry, in the same PR (project rule).

### 6. Voice catalogue endpoint

`/api/voices?provider=gemini` returns the Gemini prebuilt-voice list
(static, like `vapi-native-voices.ts`) as `VoiceOption[]` — reuses the
existing wire shape and the existing browse/preview UI. Previews use
short pre-rendered samples of each Gemini voice.

## Data flow

**Web call:** voice page / widget → token route (mint ephemeral token,
locked cfg) → browser `GeminiLiveProvider.connect()` → Gemini Live;
tool calls → Vercel tool-exec → CRM; transcript → persist on end.

**Phone call:** PSTN → Twilio number → `/api/voice/gemini/twilio` (TwiML
`<Connect><Stream>` with signed cfg ref) → Fly.io bridge → Gemini Live;
bridge transcodes audio, round-trips tool calls to Vercel, POSTs
transcript on hangup.

## Error handling

- **Web:** reuse Copilot reconnect (up to 5 retries), session-resumption,
  and the server-side max-duration ceiling (`requireActiveCopilotSession`
  pattern flips wedged sessions to `ended`).
- **Phone bridge:** if Gemini errors mid-call, the Fly bridge plays a
  graceful fallback line and (optionally) warm-transfers to a fallback
  number or drops with a voicemail prompt; never a silent dead-air hang.
  Bridge crashes/redeploys end the Twilio stream cleanly; Fly health
  checks + auto-restart cover process death.
- **Provisioning:** Twilio/Google credential or quota failures surface in
  the voice page as a typed banner (mirrors the existing `vapiError` /
  `syncError` UX), not a generic 500.
- **No silent fallback to TTS.** If Gemini native audio is unavailable we
  surface the failure — we never quietly degrade to a pipeline voice,
  because that defeats the entire point of the feature.

## Testing

- **Unit (vitest, `lib/**/*.test.ts`):** `buildGeminiSession` (prompt +
  tool mapping + constraint locking), voice catalogue mapping, TwiML
  generation, signed-params HMAC sign/verify, μ-law↔PCM transcode helpers.
- **Bridge:** transcode + relay logic unit-tested in the bridge package;
  a scripted Twilio Media Streams fixture (recorded frames) drives an
  end-to-end relay test without a live call.
- **Manual/live:** dashboard "Test voice" (web) verified in-browser;
  one real inbound phone call verified post-deploy (per the
  verify-UI-fixes-live rule).
- Route handlers + Prisma stay out of unit tests (project convention) —
  exercised via the scenario harness / manual verification.

## Build order (one branch, one ship)

Web and phone ship together. Internal sequencing within the branch:

1. **Data + shared core.** `GeminiVoiceConfig` + `voiceRuntime`
   (hand-run SQL), `buildGeminiSession`, voice catalogue, tool-exec
   endpoint.
2. **Web runtime.** Token route, widget/dashboard voice panel, transcript
   persistence, runtime picker + NewBadge. Verifiable in-browser before
   any telephony exists — this is the fastest proof of the "human" quality.
3. **Phone runtime.** Twilio provisioning, TwiML answer + signed params,
   Fly.io bridge service (`services/gemini-voice-bridge/`), transcript
   webhook sink, fallback handling.
4. **Verify-live + ship.** Dashboard "Test voice" (web) + one real inbound
   call (phone) verified, then merge to main after Ryan runs the SQL.

One implementation plan covers all four; the web seam is just built and
demoable first so we de-risk the core before standing up the bridge.

## Out of scope (YAGNI)

- Outbound campaign dialing for Gemini agents (later candidate).
- Multi-language auto-detect beyond a per-agent language setting.
- Replacing Vapi for existing agents — Vapi stays as-is; Gemini is
  additive.
- A generic N-provider voice registry abstraction — we have two runtimes
  now; introduce the abstraction only if a third appears (matches the
  prior deletionism note in `lib/voice/types.ts`).
```
