# Phase 2 — Twilio ↔ XAI Voice Bridge

This document is the spec for shipping inbound phone support on XAI voice
agents. It's scoped as a follow-up to the Phase 1 adapter work so we can
iterate without churning the UI.

## Why a separate service

Phone calls require holding a WebSocket open for the duration of the
call (1–30+ minutes) and shuttling audio frames with sub-200ms latency.
Vercel's serverless functions top out at 10–15 min and have cold-start
overhead that's too spiky for real-time audio. The bridge runs as a
persistent Node process on a host that supports long-lived WebSockets:

- Fly.io — simplest, WebSocket-native, low cost
- Railway — similar
- AWS Fargate — when scale needs it

## Architecture

```
 ┌───────────────┐    PSTN         ┌──────────┐   WS (μ-law 8k)   ┌─────────┐
 │  Caller 📞   │────────────────▶│  Twilio  │──────────────────▶│ Bridge  │
 └───────────────┘                 └──────────┘                    │ service │
                                                                   └────┬────┘
                                                                        │
                                              WS (PCM16 24kHz realtime) │
                                                                        ▼
                                                              ┌───────────────┐
                                                              │ XAI Realtime  │
                                                              │  wss://…      │
                                                              └───────────────┘
```

**Twilio side** (already scaffolded):
- Provision a Twilio number with voice enabled
- Set the voice webhook to `https://app.voxility.ai/api/twilio/voice/inbound`
- Our TwiML (see `app/api/twilio/voice/inbound/route.ts`) returns a
  `<Connect><Stream>` directive pointing at the bridge WSS URL,
  configured via `VOICE_BRIDGE_WSS_URL` env var.

**Bridge service** (to be built):
- Accept Twilio Media Streams WS on `/twilio` (or similar)
- On `Stream.Start`: look up agent config (to/from, voice, system prompt)
  by calling `https://app.voxility.ai/api/voice/bridge/session?to=…`
- Mint an XAI ephemeral token via
  `POST https://app.voxility.ai/api/voice/xai/client-secret`
- Open `wss://api.x.ai/v1/realtime` using the subprotocol auth pattern
- Configure session with voice, system prompt, PCM16 format, server VAD
- Pipe audio both ways:
  - Twilio → XAI: μ-law 8k → PCM16 24k (resample + decode),
    base64, send as `input_audio_buffer.append`
  - XAI → Twilio: `response.output_audio.delta` base64 → PCM16 24k →
    μ-law 8k (downsample + encode), frame into 20ms chunks, send as
    Twilio `media` messages

## Audio codec conversions

The tricky bit. μ-law ↔ PCM16 is a byte-level table conversion; the
resampling is the expensive step. Use `@evan/opus` for transcoding or
ship a tiny native lib. Both directions must be non-blocking (worker
threads) or latency creeps up fast.

## Session resolver

When the bridge service receives a `Stream.Start`, it needs to know
which agent + voice config to use. A small authenticated endpoint on
the main app should own that lookup:

- `GET /api/voice/bridge/session?to=<phoneNumber>` (bearer: shared secret)
- Returns `{ agentId, voiceId, systemPrompt, firstMessage }`
- Gates by a `VOICE_BRIDGE_SHARED_SECRET` env var so only our bridge
  service can hit it

Not built yet — add in the bridge-service wave.

## Env vars

Main app:
- `VOICE_BRIDGE_WSS_URL` — e.g. `wss://bridge.voxility.ai` — points
  Twilio Media Streams at the bridge service
- `VOICE_BRIDGE_SHARED_SECRET` — auth between bridge and session resolver

Bridge service:
- `VOXILITY_API_URL` — `https://app.voxility.ai`
- `VOXILITY_BRIDGE_SECRET` — matches main app's shared secret

## Non-goals for v1

- Outbound calls (bridge is inbound-only until we need outbound)
- Call recording (easy add later via Twilio's recording or local capture)
- DTMF / IVR (XAI Realtime doesn't expose this; add only if needed)
- SIP trunk (Twilio-only in v1)

## Current status

- ✅ TwiML endpoint returning `<Stream>` directive
- ✅ `XaiVoiceAdapter.getRealtimeToken()` mints ephemeral keys
- ✅ `/api/voice/xai/client-secret` endpoint (session-gated)
- ❌ Bridge service (to build)
- ❌ Session resolver `/api/voice/bridge/session`
- ❌ `VapiConfig.ttsProvider === 'xai'` flipping `capabilities.phoneCalls = true`
      — lands when the bridge is deployed and VOICE_BRIDGE_WSS_URL is set
