# Voice engines — internal note

Short reference for how voice agents are wired today.

## One provider, two engines

**Vapi is the only voice provider.** It owns the phone bridge (PSTN
in + out via Twilio under the hood), owns the @vapi-ai/web browser
SDK, and routes audio between the caller and the LLM. Every voice
surface — wizard test calls, outbound dials, inbound calls, widget
voice — goes through Vapi.

**Two voice engines (TTS) are selectable inside a Vapi assistant
config:**

| Engine | Provider string | Voices | Tuning |
|---|---|---|---|
| ElevenLabs | `'11labs'` | 5000+ catalogue | stability / similarityBoost / speed / style / model |
| xAI Grok | `'xai'` | ~5 expressive voices | none (Vapi rejects extra params on non-11labs providers) |

ElevenLabs is the default. Grok is picked per-agent via the engine
tab in the wizard's Voice step or the post-creation Voice tab.

**Default ElevenLabs model: `eleven_turbo_v2_5`.** Not `eleven_v3`.
v3 is the newest expressive model but on a phone bridge (compressed
codec, narrow bandwidth, low-latency requirement) it sounds noticeably
worse than v2.5 turbo. The expressive emotion shifts get mangled by
the codec and the longer per-utterance generation time adds
conversational lag. Override via `VAPI_ELEVENLABS_MODEL` env var if
you want to opt in to v3 for an account that has it fully enabled.

## How an agent picks its engine

1. Wizard `/agents/new/voice` Voice step has two tabs:
   `[ ElevenLabs (5000+) ]` `[ Grok (5) ]`.
2. The tab choice drives `/api/voices?provider=vapi|xai` to populate
   the voice grid.
3. On wizard submit, `VapiConfig.ttsProvider` is persisted as
   `'vapi'` (the legacy synonym for ElevenLabs) or `'xai'`.
4. At call time, `resolveVoiceEngine(vapiConfig.ttsProvider)` in
   `lib/voice/vapi-adapter.ts` maps the persisted value to a
   `VoiceEngine` (`'elevenlabs'` | `'xai'`).
5. `buildVapiVoiceBlock({ engine, voiceId, ...tuning })` emits the
   right shape for the chosen engine and inlines it into the
   assistant config sent to Vapi.

## Voice block shapes

ElevenLabs:

```json
{
  "provider": "11labs",
  "voiceId": "EXAVITQu4vr4xnSDxMaL",
  "model": "eleven_v3",
  "stability": 0.5,
  "similarityBoost": 0.75,
  "speed": 1.0,
  "style": 0.0,
  "language": "en"
}
```

xAI Grok:

```json
{
  "provider": "xai",
  "voiceId": "eve",
  "language": "en"
}
```

Tuning fields are explicitly dropped for the xAI engine. Vapi rejects
calls when extra params are sent on non-11labs providers, so the
builder strips them even if the agent's `VapiConfig` row carries
leftover values from a previous ElevenLabs config.

## Removed: the standalone xAI realtime adapter

Before this refactor we ran two parallel adapters: Vapi (phone) and
xAI (browser-only via `wss://api.x.ai/v1/realtime`). The latter is
gone — its surfaces have been deleted:

- `lib/voice/xai-adapter.ts` → replaced by the slim
  `lib/voice/xai-voices.ts` (catalogue listing only)
- `components/dashboard/XaiTestCall.tsx` → all browser test calls
  use Vapi's Web SDK
- `app/api/voice/agent-turn/route.ts` (the hybrid Claude-brain path)
- `app/api/voice/tts/route.ts` (the standalone xAI batch TTS)
- `app/api/voice/xai/client-secret/route.ts` (ephemeral realtime tokens)
- `app/api/voice/xai/preview/route.ts` (per-click TTS preview)

The voice-preview affordance for Grok voices (which don't ship a
catalogue `preview_url`) now lives at the engine-agnostic
`app/api/voice/preview/route.ts` — same on-demand xAI synthesis,
but reachable from any UI that knows the engine and voiceId.

## Env vars

- `VAPI_API_KEY` — server-side Vapi API calls
- `VAPI_PUBLIC_KEY` / `NEXT_PUBLIC_VAPI_PUBLIC_KEY` — browser SDK
- `XAI_API_KEY` — only needed for the Grok voice catalogue +
  on-demand previews. Vapi's xAI partner integration uses its own
  upstream key on the Vapi side, so we don't need ours for the actual
  phone call's audio.
- `VAPI_ELEVENLABS_MODEL` — optional override for the ElevenLabs
  model id; defaults to `eleven_turbo_v2_5`. Set to `eleven_v3` to
  opt into the alpha expressive model.
- `VAPI_XAI_PROVIDER` — optional override for the xAI provider
  string Vapi expects; defaults to `xai`. Bump to `x-ai` or `grok`
  if Vapi later renames.

## File map

```
lib/voice/
  vapi-adapter.ts      — VapiVoiceAdapter + buildVapiVoiceBlock + resolveVoiceEngine
  xai-voices.ts        — listXaiVoices() (Grok catalogue for the wizard tab)
  factory.ts           — single-provider factory (Vapi)
  types.ts             — VoiceAdapter interface

app/api/voices/route.ts          — list voices for a chosen engine
app/api/voice/preview/route.ts   — engine-agnostic preview MP3
app/api/voice/providers/route.ts — provider metadata (single entry: Vapi)
app/api/vapi/webhook/route.ts    — inbound assistant-request handler
                                   (uses buildVapiVoiceBlock for both engines)
lib/outbound-call.ts             — outbound dial (uses buildVapiVoiceBlock)
app/api/widget/[widgetId]/voice/start/route.ts
                                  — widget browser-call (same builder)
```

## Verification

End-to-end happy path:

1. **Engine = ElevenLabs**: `/agents/new/voice` → Voice step → keep
   the ElevenLabs tab → pick a voice → finish wizard → place a real
   outbound call → confirm Vapi dashboard's call log shows
   `voice.provider: '11labs'` + `voice.model: 'eleven_turbo_v2_5'`.
2. **Engine = Grok**: same flow, switch to Grok tab → pick e.g. "Eve"
   → finish → real call → Vapi dashboard shows `voice.provider: 'xai'`
   + `voice.voiceId: 'eve'` + no tuning fields.
3. **Engine swap on existing agent**: open Voice tab → toggle to Grok
   → save → place a test call → Vapi logs show engine swapped.
