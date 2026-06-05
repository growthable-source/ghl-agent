# Voice engines

_Internal note. Last updated 2026-06-06 (Round 4 — drop xAI, mirror Vapi's Riley demo)._

## The model in one paragraph

**Phone provider is always Vapi.** Vapi owns the number, owns the
phone bridge, owns the `@vapi-ai/web` browser SDK that handles
WebRTC. The user picks a **voice engine** that runs inside the Vapi
assistant config — Vapi routes audio through whichever engine the
config names. The engine is a per-agent setting, stored on
`VapiConfig.ttsProvider`.

Two engines today:

| Engine        | Stored as       | Catalogue | Tuning                                       |
|---------------|-----------------|-----------|----------------------------------------------|
| Vapi-native   | `'vapi'`        | 8 voices  | none — Vapi-native is pre-tuned              |
| ElevenLabs    | `'elevenlabs'`  | 5000+     | stability, similarityBoost, speed, style     |

Vapi-native is the default (matches Vapi's "Riley" demo agent's
stack). ElevenLabs is picked per-agent via the engine tab strip in
the wizard / Voice tab when an operator wants a specific voice
that's only in the ElevenLabs catalogue.

## How the engine is selected

1. Wizard's Voice step renders a two-tab strip:
   `[ Vapi-native (8) ]` `[ ElevenLabs (5000+) ]`. Vapi-native is
   the default tab; Elliot is pre-selected as the default voice.
2. The tab choice drives `/api/voices?provider=vapi|elevenlabs` to
   populate the voice grid.
3. The wizard submits `vapiConfig.ttsProvider` as `'vapi'` or
   `'elevenlabs'` — the canonical values.
4. `lib/voice/vapi-adapter.ts:resolveVoiceEngine` maps the persisted
   string back to a `VoiceEngine` (`'elevenlabs'` | `'vapi'`).
   Unknown / null / legacy `'xai'` rows fall back to `'vapi'`.
5. `buildVapiVoiceBlock` picks the right Vapi voice-block shape per
   engine.

## Voice-block shape per engine

Vapi-native:
```json
{
  "provider": "vapi",
  "voiceId": "elliot"
}
```

ElevenLabs:
```json
{
  "provider": "11labs",
  "voiceId": "<elevenlabs-id>",
  "model": "eleven_turbo_v2_5",
  "stability": 0.5,
  "similarityBoost": 0.7
}
```

ElevenLabs-specific tuning fields are explicitly dropped for the
Vapi-native engine — Vapi rejects extra params on the `'vapi'`
provider, so the UI hides the sliders and the builder strips them.

The ElevenLabs default model is `eleven_turbo_v2_5` (Vapi's
recommended model for phone calls). Override at deploy time with
`VAPI_ELEVENLABS_MODEL` if needed (e.g. opt into `eleven_v3`).

## Default model + transcriber stack

Riley's stack, applied server-side in
`lib/voice/vapi-assistant.ts:buildVapiAssistantConfig`:

| Slot         | Default                       | Env override                                          |
|--------------|-------------------------------|-------------------------------------------------------|
| Model        | `openai` / `gpt-4.1`          | `VAPI_DEFAULT_MODEL_PROVIDER`, `VAPI_DEFAULT_MODEL`   |
| Transcriber  | `deepgram` / `nova-3` / `en`  | `VAPI_DEFAULT_TRANSCRIBER_PROVIDER`, `VAPI_DEFAULT_TRANSCRIBER_MODEL`, `VAPI_DEFAULT_TRANSCRIBER_LANGUAGE` |
| Voice        | `vapi` / `elliot`             | per-agent on `VapiConfig`                             |

## Removed: the standalone xAI realtime adapter

Up to 2026-06-05 the platform shipped a parallel xAI realtime path
that talked directly to `wss://api.x.ai/v1/realtime`. That path is
gone — every voice surface (browser test calls, widgets, agent
test) now goes through Vapi. xAI is no longer an engine choice
(2026-06-06: dropped entirely after browser test calls failed
through every combination of inline assistant config shapes,
including the Vapi-documented xAI partner integration).

## Where the code lives

- `lib/voice/vapi-adapter.ts` — engine resolver +
  `buildVapiVoiceBlock` voice-block builder + ElevenLabs adapter.
- `lib/voice/vapi-native-voices.ts` — hardcoded catalogue of the 8
  Vapi-native voices (Elliot, Cole, Harry, Spencer, Rohan, Hana,
  Paige, Neha) with preview URLs at `storage.vapi.ai/<name>.wav`.
- `lib/voice/vapi-assistant.ts` — single source of truth for the
  assistant config that gets POSTed to Vapi (`createAssistant` /
  `updateAssistant`), including model + transcriber defaults.
- `lib/voice/factory.ts` — provider factory; returns the sole Vapi
  adapter regardless of input.
- `app/api/voices/route.ts` — voice catalogue endpoint.
- `app/api/voice/preview/route.ts` — preview audio (Vapi-native →
  302 to the CDN sample; ElevenLabs returns preview_url inline).
- `app/dashboard/[workspaceId]/voice/new/page.tsx` — wizard
  (canonical URL).
- `app/dashboard/[workspaceId]/voice/page.tsx` — voice agent list.
- `components/dashboard/VoicePhoneCallUI.tsx` — phone-call simulator.
