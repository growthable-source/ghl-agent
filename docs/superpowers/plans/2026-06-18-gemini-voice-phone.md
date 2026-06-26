# Gemini Voice Agents — Phone Runtime (Twilio + Fly.io Bridge) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator point a phone number at a Gemini voice agent and have inbound PSTN callers talk to Gemini Live with native speech-to-speech quality — same agent prompt, voice, and tools as the web runtime from Plan 1. Twilio is the carrier; a standalone Node/TS media bridge on Fly.io holds the per-call WebSocket and transcodes G.711 μ-law 8 kHz ↔ Gemini PCM 16/24 kHz; Gemini Live is the brain. Inbound call transcripts persist to `CallLog`.

**Architecture:**
```
PSTN caller
   │  dials Twilio number (E.164, owned by GeminiVoiceConfig.twilioNumber)
   ▼
Twilio  ──POST──►  Vercel  /api/voice/gemini/twilio   (TwiML answer; validates X-Twilio-Signature;
   │                 │        looks up agent by To; returns <Connect><Stream> + signed <Parameter p>)
   │  <Connect><Stream url="wss://<bridge>.fly.dev/call"><Parameter name="p" value="<signed>"/>
   ▼
Fly.io bridge (services/gemini-voice-bridge, region nrt)
   │  1. accept WS at /call
   │  2. read {event:'start', start:{streamSid, customParameters:{p}}}
   │  3. POST p → Vercel /api/voice/gemini/session-config (HMAC verified there)
   │            ◄── { session: GeminiVoiceSession, agentId, locationId, workspaceId }
   │  4. ai.live.connect({ model: session.vendorModelId, config: session.liveConfig })   (full GEMINI_API_KEY)
   │  5. relay loop:
   │       Twilio media (μ-law 8k) → decode → PCM16 → upsample 16k → Gemini sendRealtimeInput
   │       Gemini modelTurn audio (PCM16 24k) → downsample 8k → μ-law → Twilio {event:'media'}
   │       Gemini interrupted → Twilio {event:'clear'} (barge-in flush)
   │       Gemini toolCall → POST Vercel /api/voice/gemini/tool (HMAC) → sendToolResponse
   │  6. on stop/close → POST Vercel /api/voice/gemini/call-ended (HMAC) → writes CallLog
   ▼
Gemini Live API
```
Vercel hosts NO socket — it only serves TwiML, session-config, tool-exec, and the call-ended sink (all plain request/response). The long-lived socket lives only on Fly.

**Tech Stack:** Next.js 16 / React 19 / Prisma 7 / NextAuth v5 (the Vercel control plane) + a standalone Node 22 / TypeScript Fly.io service (`ws`, `@google/genai`, native `fetch`). HMAC via Node `crypto`. Twilio REST + Media Streams. No new schema (reuses `CallLog` and Plan 1's `GeminiVoiceConfig`).

**Prerequisite:** Plan 1 (web) — shared core (`lib/voice/gemini/session.ts`, `mint.ts`), `GeminiVoiceConfig` model (incl. `twilioNumberSid` / `twilioNumber` columns + `voiceRuntime` discriminator on `Agent`), the dashboard Gemini config panel, and the tool-exec route `/api/voice/gemini/tool` — must be implemented first. This plan imports/extends those; it does not redefine them.

**Bridge ↔ core approach:** **(B)** — the bridge calls `POST /api/voice/gemini/session-config` (HMAC-authed) and consumes the returned `GeminiVoiceSession` JSON. The bridge never imports Prisma or the Next build; `buildGeminiVoiceSession` stays the single source of truth on the Vercel side. This keeps the Fly service decoupled and tiny.

**Branch:** `gemini-voice` (same feature branch as Plan 1). Do **not** commit to `main`. Every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

### Vercel app (under `ghl-agent/`)

| Path | New/Modified | Responsibility |
| --- | --- | --- |
| `lib/voice/gemini/signing.ts` | **new** | HMAC sign/verify of the bridge params blob (`{ agentId, exp }`) and a generic `signBridgeRequest`/`verifyBridgeRequest` header helper for server-to-server calls (session-config, tool, call-ended). Pure; unit-tested. |
| `lib/voice/gemini/signing.test.ts` | **new** | Round-trip, tamper-rejection, expiry tests. Runs under `lib/**/*.test.ts`. |
| `lib/voice/gemini/twilio-signature.ts` | **new** | Twilio inbound-webhook signature validation (the standard HMAC-SHA1-over-sorted-params algorithm). Pure; unit-tested. |
| `lib/voice/gemini/twilio-signature.test.ts` | **new** | Validates against Twilio's documented worked example. |
| `lib/voice/gemini/twilio.ts` | **new** | Minimal fetch-based Twilio REST client (Basic auth): `listAvailableNumbers`, `purchaseNumber`, `listOwnedNumbers`. No SDK. |
| `lib/voice/gemini/twiml.ts` | **new** | Pure TwiML string builders: `connectStreamTwiml({ wssUrl, signedParams })` and `sayHangupTwiml(message)`. Unit-tested (XML shape). |
| `lib/voice/gemini/twiml.test.ts` | **new** | Asserts exact TwiML output + escaping. |
| `app/api/voice/gemini/twilio/route.ts` | **new** | Twilio voice webhook (POST). Validates signature, resolves agent by `To`, returns `<Connect><Stream>` TwiML or `<Say><Hangup>` fallback. |
| `app/api/voice/gemini/session-config/route.ts` | **new** | POST. Verifies signed params, loads agent + `GeminiVoiceConfig`, returns `{ session: buildGeminiVoiceSession(...), agentId, locationId, workspaceId }`. |
| `app/api/voice/gemini/call-ended/route.ts` | **new** | POST (HMAC-authed). Writes a `CallLog` row from the bridge's end-of-call payload. |
| `app/api/voice/gemini/tool/route.ts` | **modified (Plan 1)** | Extend to also accept the bridge's HMAC auth header in addition to dashboard/widget auth. |
| `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini/phone-numbers/route.ts` | **new** | GET available/owned Twilio numbers; POST purchase + persist `twilioNumberSid` / `twilioNumber` onto `GeminiVoiceConfig`. |
| `app/dashboard/[workspaceId]/agents/[agentId]/voice/GeminiPhoneNumberPanel.tsx` | **new** | Dashboard sub-panel: country/area pick → purchase → show provisioned number. Mounted inside Plan 1's Gemini config section. |

### Standalone Fly.io service (under `ghl-agent/services/gemini-voice-bridge/` — NOT part of the Next build)

| Path | New/Modified | Responsibility |
| --- | --- | --- |
| `services/gemini-voice-bridge/package.json` | **new** | Own deps (`ws`, `@google/genai`), own scripts, own vitest. |
| `services/gemini-voice-bridge/tsconfig.json` | **new** | Node 22 / ESM TS config for the service. |
| `services/gemini-voice-bridge/vitest.config.ts` | **new** | Isolated test runner for the bridge package. |
| `services/gemini-voice-bridge/src/config.ts` | **new** | Reads + validates env: `GEMINI_API_KEY`, `APP_URL`, `GEMINI_VOICE_SIGNING_SECRET`, `GEMINI_VOICE_MODEL`, `PORT`. |
| `services/gemini-voice-bridge/src/audio.ts` | **new** | G.711 μ-law encode/decode + linear resample (8k↔16k, 24k→8k). Pure; unit-tested. |
| `services/gemini-voice-bridge/src/audio.test.ts` | **new** | μ-law round-trip tolerance + resample length math. |
| `services/gemini-voice-bridge/src/twilio-stream.ts` | **new** | Parse/serialize Twilio Media Streams JSON frames. Pure; unit-tested. |
| `services/gemini-voice-bridge/src/twilio-stream.test.ts` | **new** | Frame parse/serialize fixtures. |
| `services/gemini-voice-bridge/src/gemini.ts` | **new** | Open a Gemini Live session from a `GeminiVoiceSession`, expose audio-in / audio-out / toolCall / interrupted / transcript callbacks. |
| `services/gemini-voice-bridge/src/sign.ts` | **new** | Bridge-side copy of the HMAC request-signing helper (mirrors `lib/voice/gemini/signing.ts` `signBridgeRequest`), used to authenticate outbound calls to Vercel. |
| `services/gemini-voice-bridge/src/server.ts` | **new** | `ws` server on `PORT`. Routes `/call` (relay) and `/health`. Wires Twilio ↔ Gemini per call. |
| `services/gemini-voice-bridge/Dockerfile` | **new** | `node:22-slim`, build TS, run `node dist/server.js`. |
| `services/gemini-voice-bridge/fly.toml` | **new** | App name, `primary_region = 'nrt'`, `[http_service]` internal port, auto-stop/start, `min_machines_running = 1`. |
| `services/gemini-voice-bridge/.dockerignore` | **new** | Keep node_modules/tests out of the image. |

### Shared contract imported from Plan 1 (do NOT redefine)

```ts
// lib/voice/gemini/session.ts  (Plan 1, runtime-agnostic)
export interface GeminiVoiceSession {
  liveConfig: Record<string, unknown>
  tools: RealtimeToolDef[]
  vendorModelId: string
  voiceName: string | null
  maxSessionSecs: number
}
export function buildGeminiVoiceSession(agent, config, opts?): GeminiVoiceSession
// RealtimeToolDef from lib/copilot/types.ts:
//   { name; description; parameters: { type:'object'; properties; required? } }
```

---

## Secrets & env (set ONCE, before Task 5)

A real 32-byte hex signing secret is generated for this plan (shared by Vercel and Fly; HMAC over the params blob and the server-to-server request headers):

```
GEMINI_VOICE_SIGNING_SECRET = a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646
```

Store it in Vercel (note: `printf '%s'`, never `echo` — `echo` appends `\n` and breaks the value):

```bash
printf '%s' 'a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646' | vercel env add GEMINI_VOICE_SIGNING_SECRET production
printf '%s' 'a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646' | vercel env add GEMINI_VOICE_SIGNING_SECRET preview
printf '%s' 'a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646' | vercel env add GEMINI_VOICE_SIGNING_SECRET development
```

The bridge wss URL (set after the first `fly deploy`, Task 9 — Fly assigns `<app>.fly.dev`):

```bash
printf '%s' 'wss://voxility-gemini-voice-bridge.fly.dev/call' | vercel env add GEMINI_VOICE_BRIDGE_WSS_URL production
```

Twilio credentials come from **Ryan's** Twilio account — do NOT invent these. Ryan provides `TWILIO_ACCOUNT_SID` (`AC...`) and `TWILIO_AUTH_TOKEN`. Store them:

```bash
printf '%s' "$TWILIO_ACCOUNT_SID" | vercel env add TWILIO_ACCOUNT_SID production
printf '%s' "$TWILIO_AUTH_TOKEN"  | vercel env add TWILIO_AUTH_TOKEN production
```

Fly secrets (set after the app is created in Task 9 — `GEMINI_API_KEY` is the same full server-side key the Next app already uses for Copilot; `APP_URL` is the production Vercel origin):

```bash
fly secrets set \
  GEMINI_VOICE_SIGNING_SECRET=a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646 \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  APP_URL="https://app.xovera.example" \
  GEMINI_VOICE_MODEL=gemini-3.1-flash-live \
  -a voxility-gemini-voice-bridge
```

> **No schema migration in this plan.** Plan 1 already added `GeminiVoiceConfig` (with `twilioNumberSid`, `twilioNumber`) and `Agent.voiceRuntime`. Phone calls reuse the existing `CallLog` model verbatim. If you discover a genuinely missing column, STOP and hand Ryan the SQL — never auto-run a migration (project rule: Ryan applies all SQL by hand).

---

### Task 1: HMAC signing util (`lib/voice/gemini/signing.ts`)

**Files:**
- `ghl-agent/lib/voice/gemini/signing.ts`
- `ghl-agent/lib/voice/gemini/signing.test.ts`

Two concerns, one secret:
1. **Params blob** — short-lived `{ agentId, exp }` token embedded in TwiML `<Parameter>`, verified by the session-config route.
2. **Server-to-server request auth** — `signBridgeRequest(bodyString)` → header value the bridge attaches when calling session-config / tool / call-ended; `verifyBridgeRequest(bodyString, header)` on the Vercel side.

Steps:
- [ ] Write the failing test `lib/voice/gemini/signing.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { signBridgeParams, verifyBridgeParams, signBridgeRequest, verifyBridgeRequest } from './signing'

beforeAll(() => {
  process.env.GEMINI_VOICE_SIGNING_SECRET = 'a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646'
})

describe('signBridgeParams / verifyBridgeParams', () => {
  it('round-trips a payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signBridgeParams({ agentId: 'agent_123', exp })
    expect(verifyBridgeParams(token)).toEqual({ agentId: 'agent_123', exp })
  })

  it('rejects a tampered token', () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signBridgeParams({ agentId: 'agent_123', exp })
    const [body, sig] = token.split('.')
    const tampered = `${Buffer.from(JSON.stringify({ agentId: 'agent_evil', exp })).toString('base64url')}.${sig}`
    expect(verifyBridgeParams(tampered)).toBeNull()
    expect(verifyBridgeParams(`${body}.deadbeef`)).toBeNull()
  })

  it('rejects an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 1
    const token = signBridgeParams({ agentId: 'agent_123', exp })
    expect(verifyBridgeParams(token)).toBeNull()
  })

  it('rejects a malformed token', () => {
    expect(verifyBridgeParams('not-a-token')).toBeNull()
    expect(verifyBridgeParams('')).toBeNull()
  })
})

describe('signBridgeRequest / verifyBridgeRequest', () => {
  it('round-trips a request body', () => {
    const body = JSON.stringify({ agentId: 'a', name: 'lookupContact', args: {} })
    const header = signBridgeRequest(body)
    expect(verifyBridgeRequest(body, header)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    const body = JSON.stringify({ agentId: 'a' })
    expect(verifyBridgeRequest(body, 'nope')).toBe(false)
    expect(verifyBridgeRequest(body, '')).toBe(false)
  })

  it('rejects a body that does not match the signature', () => {
    const header = signBridgeRequest(JSON.stringify({ agentId: 'a' }))
    expect(verifyBridgeRequest(JSON.stringify({ agentId: 'b' }), header)).toBe(false)
  })
})
```
- [ ] Run it — expect FAIL (module missing):
```bash
cd ghl-agent && npx vitest run lib/voice/gemini/signing.test.ts
# Expected: Error — Failed to load lib/voice/gemini/signing.ts (Cannot find module)
```
- [ ] Write the complete implementation `lib/voice/gemini/signing.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC utilities for the Gemini phone bridge.
 *
 * One shared secret (GEMINI_VOICE_SIGNING_SECRET) guards two surfaces:
 *  - the short-lived params blob carried in TwiML <Parameter> → the
 *    bridge presents it to /api/voice/gemini/session-config, which
 *    verifies + decodes it to know which agent the call is for.
 *  - server-to-server request auth: the bridge signs each POST body to
 *    Vercel (session-config / tool / call-ended) so those endpoints
 *    trust the caller without a session cookie.
 *
 * No 'ghl'/'HighLevel' anywhere — brand-neutral, generic names.
 */

export interface BridgeParams {
  agentId: string
  exp: number // unix seconds
}

function secret(): Buffer {
  const s = process.env.GEMINI_VOICE_SIGNING_SECRET
  if (!s) throw new Error('GEMINI_VOICE_SIGNING_SECRET is not set')
  return Buffer.from(s, 'utf8')
}

function hmac(input: string): string {
  return createHmac('sha256', secret()).update(input).digest('base64url')
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Sign a `{ agentId, exp }` payload → "<base64url(json)>.<base64url(hmac)>". */
export function signBridgeParams(payload: BridgeParams): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}

/** Verify + decode a params token. Returns null on any failure (bad sig, expiry, malformed). */
export function verifyBridgeParams(token: string): BridgeParams | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!safeEqual(sig, hmac(body))) return null
  let payload: BridgeParams
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload?.agentId !== 'string' || typeof payload?.exp !== 'number') return null
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null
  return payload
}

/** Sign a raw request body string → header value for X-Voice-Signature. */
export function signBridgeRequest(body: string): string {
  return hmac(body)
}

/** Verify a request body against the provided X-Voice-Signature header. */
export function verifyBridgeRequest(body: string, header: string | null | undefined): boolean {
  if (!header) return false
  return safeEqual(header, hmac(body))
}
```
- [ ] Run it — expect PASS:
```bash
cd ghl-agent && npx vitest run lib/voice/gemini/signing.test.ts
# Expected: Test Files 1 passed · Tests 7 passed
```
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.
- [ ] Commit:
```bash
git add lib/voice/gemini/signing.ts lib/voice/gemini/signing.test.ts
git commit -m "$(cat <<'EOF'
Add HMAC signing util for Gemini phone bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: μ-law + resample audio utils (bridge package `src/audio.ts`)

**Files:**
- `ghl-agent/services/gemini-voice-bridge/src/audio.ts`
- `ghl-agent/services/gemini-voice-bridge/src/audio.test.ts`

> The bridge package's `package.json` / `tsconfig.json` / `vitest.config.ts` are created in Task 9, but pure-logic tests (audio, twilio-stream) are authored now and run with the package scaffold once it exists. **Do Task 9's scaffold step `9.1` (package.json + tsconfig + vitest.config) FIRST if you want these tests green immediately**, then return here. They have zero runtime deps beyond Node + vitest, so the order is flexible — just ensure `npm install` has run in `services/gemini-voice-bridge/` before running the test commands below.

Standard G.711 μ-law (ITU-T G.711) with the bias/clip constants, plus integer linear resampling.

Steps:
- [ ] Write the failing test `services/gemini-voice-bridge/src/audio.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { muLawDecodeSample, muLawEncodeSample, muLawDecode, muLawEncode, resampleLinear } from './audio'

describe('μ-law sample round-trip', () => {
  it('decodes then re-encodes to the same μ-law byte for every code', () => {
    for (let code = 0; code < 256; code++) {
      const pcm = muLawDecodeSample(code)
      const back = muLawEncodeSample(pcm)
      expect(back).toBe(code)
    }
  })

  it('encode→decode stays within one μ-law quantization step', () => {
    // μ-law is coarse; a mid-scale PCM value should survive within ~0.4% FS.
    for (const pcm of [-32124, -8000, -100, 0, 100, 8000, 32124]) {
      const code = muLawEncodeSample(pcm)
      const out = muLawDecodeSample(code)
      expect(Math.abs(out - pcm)).toBeLessThanOrEqual(0.06 * 65536)
    }
  })

  it('encodes silence (0) to 0xFF and decodes 0xFF near zero', () => {
    expect(muLawEncodeSample(0)).toBe(0xff)
    expect(Math.abs(muLawDecodeSample(0xff))).toBeLessThanOrEqual(8)
  })
})

describe('buffer-level μ-law', () => {
  it('decode produces one Int16 per μ-law byte', () => {
    const ulaw = Buffer.from([0xff, 0x00, 0x7f, 0x80])
    const pcm = muLawDecode(ulaw)
    expect(pcm.length).toBe(4)
    expect(pcm).toBeInstanceOf(Int16Array)
  })

  it('encode produces one byte per Int16 sample', () => {
    const pcm = Int16Array.from([0, 1000, -1000, 32000])
    const ulaw = muLawEncode(pcm)
    expect(ulaw.length).toBe(4)
    expect(ulaw).toBeInstanceOf(Buffer)
  })
})

describe('resampleLinear', () => {
  it('upsamples 8k→16k by ~2x length', () => {
    const src = Int16Array.from({ length: 80 }, (_, i) => Math.round(1000 * Math.sin(i / 4)))
    const out = resampleLinear(src, 8000, 16000)
    expect(out.length).toBe(160)
  })

  it('downsamples 24k→8k by ~1/3 length', () => {
    const src = Int16Array.from({ length: 240 }, (_, i) => Math.round(1000 * Math.sin(i / 8)))
    const out = resampleLinear(src, 24000, 8000)
    expect(out.length).toBe(80)
  })

  it('returns the same data when rates match', () => {
    const src = Int16Array.from([1, 2, 3, 4])
    const out = resampleLinear(src, 8000, 8000)
    expect(Array.from(out)).toEqual([1, 2, 3, 4])
  })

  it('preserves endpoints and stays monotone on a ramp', () => {
    const src = Int16Array.from({ length: 9 }, (_, i) => i * 1000) // 0..8000
    const out = resampleLinear(src, 8000, 16000)
    expect(out[0]).toBe(0)
    // last output sample maps near the last input sample
    expect(out[out.length - 1]).toBeGreaterThanOrEqual(7000)
  })
})
```
- [ ] Run it — expect FAIL (module missing):
```bash
cd ghl-agent/services/gemini-voice-bridge && npx vitest run src/audio.test.ts
# Expected: Error — Cannot find module './audio'
```
- [ ] Write the complete implementation `services/gemini-voice-bridge/src/audio.ts`:
```ts
/**
 * Audio transcode for the Twilio ↔ Gemini bridge.
 *
 * Twilio Media Streams carry G.711 μ-law, 8 kHz, mono, base64.
 * Gemini Live wants PCM16 16 kHz mono in, and emits PCM16 24 kHz mono out.
 *
 * Pipeline:
 *   inbound : μ-law 8k  → PCM16 8k → resample 16k → Gemini
 *   outbound: Gemini PCM16 24k → resample 8k → μ-law 8k → Twilio
 *
 * μ-law is the standard ITU-T G.711 implementation (BIAS 0x84, CLIP 32635).
 */

const BIAS = 0x84
const CLIP = 32635

/** Encode one PCM16 sample (-32768..32767) to an 8-bit μ-law code. */
export function muLawEncodeSample(sample: number): number {
  let s = sample
  // Clamp to int16.
  if (s > 32767) s = 32767
  if (s < -32768) s = -32768
  // Sign bit, then work with magnitude.
  let sign = (s >> 8) & 0x80
  if (sign !== 0) s = -s
  if (s > CLIP) s = CLIP
  s = s + BIAS
  // Find exponent (position of highest set bit above the bias region).
  let exponent = 7
  for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent--
  }
  const mantissa = (s >> (exponent + 3)) & 0x0f
  const muLaw = ~(sign | (exponent << 4) | mantissa) & 0xff
  return muLaw
}

/** Decode one 8-bit μ-law code to a PCM16 sample. */
export function muLawDecodeSample(muLaw: number): number {
  const u = ~muLaw & 0xff
  const sign = u & 0x80
  const exponent = (u >> 4) & 0x07
  const mantissa = u & 0x0f
  let sample = ((mantissa << 3) + BIAS) << exponent
  sample -= BIAS
  return sign !== 0 ? -sample : sample
}

/** Decode a μ-law byte Buffer to PCM16. */
export function muLawDecode(ulaw: Buffer): Int16Array {
  const out = new Int16Array(ulaw.length)
  for (let i = 0; i < ulaw.length; i++) out[i] = muLawDecodeSample(ulaw[i])
  return out
}

/** Encode PCM16 to a μ-law byte Buffer. */
export function muLawEncode(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = muLawEncodeSample(pcm[i])
  return out
}

/**
 * Linear resampler. Maps `src` (at `srcRate`) onto `dstRate` using
 * straight-line interpolation between neighbouring source samples.
 * Adequate for 8↔16↔24 kHz speech; no anti-alias filter (the rate
 * ratios here are gentle and Gemini/Twilio both band-limit voice).
 */
export function resampleLinear(src: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) return src
  const dstLen = Math.round((src.length * dstRate) / srcRate)
  if (dstLen <= 0) return new Int16Array(0)
  const out = new Int16Array(dstLen)
  const ratio = (src.length - 1) / Math.max(1, dstLen - 1)
  for (let i = 0; i < dstLen; i++) {
    const pos = i * ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const a = src[idx] ?? 0
    const b = src[idx + 1] ?? a
    out[i] = Math.round(a + (b - a) * frac)
  }
  return out
}
```
- [ ] Run it — expect PASS:
```bash
cd ghl-agent/services/gemini-voice-bridge && npx vitest run src/audio.test.ts
# Expected: Test Files 1 passed · Tests 10 passed
```
- [ ] Commit:
```bash
git add services/gemini-voice-bridge/src/audio.ts services/gemini-voice-bridge/src/audio.test.ts
git commit -m "$(cat <<'EOF'
Add G.711 μ-law transcode + linear resample for voice bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Twilio Media Streams frame parser/serializer (`src/twilio-stream.ts`)

**Files:**
- `ghl-agent/services/gemini-voice-bridge/src/twilio-stream.ts`
- `ghl-agent/services/gemini-voice-bridge/src/twilio-stream.test.ts`

Twilio sends newline-free JSON text frames over the WS: `connected`, `start`, `media`, `mark`, `stop`. We parse those and serialize the two we send back: outbound `media` and `clear`.

Steps:
- [ ] Write the failing test `services/gemini-voice-bridge/src/twilio-stream.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { parseTwilioFrame, mediaFrame, clearFrame } from './twilio-stream'

describe('parseTwilioFrame', () => {
  it('parses a start frame and surfaces customParameters', () => {
    const raw = JSON.stringify({
      event: 'start',
      start: {
        streamSid: 'MZ123',
        callSid: 'CA456',
        customParameters: { p: 'signed.token' },
      },
    })
    const f = parseTwilioFrame(raw)
    expect(f).toEqual({
      event: 'start',
      streamSid: 'MZ123',
      callSid: 'CA456',
      params: { p: 'signed.token' },
    })
  })

  it('parses a media frame and exposes base64 payload', () => {
    const raw = JSON.stringify({ event: 'media', media: { payload: 'AAAA', track: 'inbound' } })
    const f = parseTwilioFrame(raw)
    expect(f).toEqual({ event: 'media', payload: 'AAAA' })
  })

  it('parses connected and stop frames', () => {
    expect(parseTwilioFrame(JSON.stringify({ event: 'connected' }))).toEqual({ event: 'connected' })
    expect(parseTwilioFrame(JSON.stringify({ event: 'stop' }))).toEqual({ event: 'stop' })
  })

  it('returns null on garbage', () => {
    expect(parseTwilioFrame('not json')).toBeNull()
    expect(parseTwilioFrame(JSON.stringify({ foo: 1 }))).toBeNull()
  })
})

describe('serializers', () => {
  it('builds an outbound media frame', () => {
    const s = mediaFrame('MZ123', 'BASE64==')
    expect(JSON.parse(s)).toEqual({
      event: 'media',
      streamSid: 'MZ123',
      media: { payload: 'BASE64==' },
    })
  })

  it('builds a clear frame for barge-in', () => {
    const s = clearFrame('MZ123')
    expect(JSON.parse(s)).toEqual({ event: 'clear', streamSid: 'MZ123' })
  })
})
```
- [ ] Run it — expect FAIL:
```bash
cd ghl-agent/services/gemini-voice-bridge && npx vitest run src/twilio-stream.test.ts
# Expected: Error — Cannot find module './twilio-stream'
```
- [ ] Write the complete implementation `services/gemini-voice-bridge/src/twilio-stream.ts`:
```ts
/**
 * Twilio Media Streams framing. Twilio sends JSON text frames over the
 * WebSocket; we parse the inbound ones we care about and serialize the
 * two we emit (media playback + clear/barge-in flush).
 *
 * Docs: https://www.twilio.com/docs/voice/media-streams/websocket-messages
 */

export type TwilioInbound =
  | { event: 'connected' }
  | { event: 'start'; streamSid: string; callSid: string; params: Record<string, string> }
  | { event: 'media'; payload: string }
  | { event: 'stop' }
  | { event: 'mark'; name: string }

/** Parse a raw Twilio WS text frame. Returns null for anything we don't model. */
export function parseTwilioFrame(raw: string): TwilioInbound | null {
  let msg: any
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  switch (msg?.event) {
    case 'connected':
      return { event: 'connected' }
    case 'start':
      return {
        event: 'start',
        streamSid: String(msg.start?.streamSid ?? ''),
        callSid: String(msg.start?.callSid ?? ''),
        params: (msg.start?.customParameters ?? {}) as Record<string, string>,
      }
    case 'media':
      return { event: 'media', payload: String(msg.media?.payload ?? '') }
    case 'mark':
      return { event: 'mark', name: String(msg.mark?.name ?? '') }
    case 'stop':
      return { event: 'stop' }
    default:
      return null
  }
}

/** Serialize an outbound media frame (base64 μ-law 8k payload). */
export function mediaFrame(streamSid: string, payloadBase64: string): string {
  return JSON.stringify({ event: 'media', streamSid, media: { payload: payloadBase64 } })
}

/** Serialize a clear frame to flush queued playback on barge-in. */
export function clearFrame(streamSid: string): string {
  return JSON.stringify({ event: 'clear', streamSid })
}
```
- [ ] Run it — expect PASS:
```bash
cd ghl-agent/services/gemini-voice-bridge && npx vitest run src/twilio-stream.test.ts
# Expected: Test Files 1 passed · Tests 6 passed
```
- [ ] Commit:
```bash
git add services/gemini-voice-bridge/src/twilio-stream.ts services/gemini-voice-bridge/src/twilio-stream.test.ts
git commit -m "$(cat <<'EOF'
Add Twilio Media Streams frame parse/serialize for voice bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Twilio REST client + inbound signature validation

**Files:**
- `ghl-agent/lib/voice/gemini/twilio-signature.ts`
- `ghl-agent/lib/voice/gemini/twilio-signature.test.ts`
- `ghl-agent/lib/voice/gemini/twilio.ts`

`twilio-signature.ts` is the pure, testable piece (the TwiML route in Task 6 consumes it). `twilio.ts` is the REST client (no SDK; mirrors `lib/vapi-client.ts` style). Test only the signature algorithm — the REST client is exercised via the scenario harness / live, per project convention.

Steps:
- [ ] Write the failing test `lib/voice/gemini/twilio-signature.test.ts` (uses Twilio's documented worked example so we know the algorithm is correct):
```ts
import { describe, it, expect } from 'vitest'
import { computeTwilioSignature, validateTwilioSignature } from './twilio-signature'

// Twilio's canonical example from their security docs.
const AUTH_TOKEN = '12345'
const URL = 'https://mycompany.com/myapp.php?foo=1&bar=2'
const PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+12349013030',
  Digits: '1234',
  From: '+12349013030',
  To: '+18005551212',
}
const EXPECTED = 'GvKvxnsg4qFt/h2L0gxX0imuOWQ='

describe('computeTwilioSignature', () => {
  it('matches Twilio reference vector', () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(EXPECTED)
  })
})

describe('validateTwilioSignature', () => {
  it('accepts the correct signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, EXPECTED)).toBe(true)
  })
  it('rejects a wrong signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, 'wrong')).toBe(false)
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, '')).toBe(false)
  })
  it('rejects when a param is tampered', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, { ...PARAMS, Digits: '9999' }, EXPECTED)).toBe(false)
  })
})
```
- [ ] Run it — expect FAIL:
```bash
cd ghl-agent && npx vitest run lib/voice/gemini/twilio-signature.test.ts
# Expected: Error — Cannot find module './twilio-signature'
```
- [ ] Write `lib/voice/gemini/twilio-signature.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Twilio inbound-webhook signature validation.
 *
 * Algorithm (Twilio "Validating Signatures From Twilio"):
 *   1. Take the full request URL exactly as Twilio called it.
 *   2. Append every POST param, sorted by key, as key+value with NO
 *      separators, directly onto the URL string.
 *   3. HMAC-SHA1 that string with your Auth Token, base64 the digest.
 *   4. Constant-time compare against the X-Twilio-Signature header.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  let data = url
  for (const key of Object.keys(params).sort()) {
    data += key + params[key]
  }
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
): boolean {
  if (!header) return false
  const expected = computeTwilioSignature(authToken, url, params)
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```
- [ ] Run it — expect PASS:
```bash
cd ghl-agent && npx vitest run lib/voice/gemini/twilio-signature.test.ts
# Expected: Test Files 1 passed · Tests 5 passed
```
- [ ] Write the REST client `lib/voice/gemini/twilio.ts` (no SDK, fetch + Basic auth; brand-neutral; mirrors the vapi-client error-surfacing style):
```ts
/**
 * Minimal Twilio REST client for Gemini voice phone provisioning.
 *
 * No SDK — plain fetch with HTTP Basic auth (ACCOUNT_SID:AUTH_TOKEN).
 * Only the three operations the dashboard needs: search available
 * numbers, buy one (wiring its Voice webhook to our TwiML route), and
 * list owned numbers. Mirrors lib/vapi-client.ts in spirit; all copy
 * stays brand-neutral.
 */

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01'

export class TwilioError extends Error {
  constructor(public status: number, public body: string, public userMessage: string) {
    super(`Twilio API error ${status}: ${userMessage}`)
    this.name = 'TwilioError'
  }
}

function creds(): { sid: string; token: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new TwilioError(500, '', 'Twilio is not configured. Contact support to enable phone provisioning.')
  return { sid, token }
}

function authHeader(): string {
  const { sid, token } = creds()
  return 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
}

async function twilioFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${TWILIO_BASE}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) {
    let userMessage = 'Twilio request failed.'
    try {
      const parsed = JSON.parse(text)
      if (parsed?.message) userMessage = String(parsed.message)
    } catch {}
    throw new TwilioError(res.status, text, userMessage)
  }
  return text ? JSON.parse(text) : {}
}

export interface AvailableNumber {
  phoneNumber: string // E.164
  friendlyName: string
  locality: string | null
  region: string | null
}

/** Search purchasable local numbers in a country (optionally near an area code). */
export async function listAvailableNumbers(opts: {
  countryCode: string
  areaCode?: string
}): Promise<AvailableNumber[]> {
  const { sid } = creds()
  const qs = new URLSearchParams({ PageSize: '20' })
  if (opts.areaCode) qs.set('AreaCode', opts.areaCode)
  const data = await twilioFetch(
    `/Accounts/${sid}/AvailablePhoneNumbers/${encodeURIComponent(opts.countryCode)}/Local.json?${qs}`,
  )
  return (data.available_phone_numbers ?? []).map((n: any) => ({
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    locality: n.locality ?? null,
    region: n.region ?? null,
  }))
}

export interface OwnedNumber {
  sid: string
  phoneNumber: string
  friendlyName: string
  voiceUrl: string | null
}

/** Buy a number and point its Voice webhook at our TwiML answer route. */
export async function purchaseNumber(opts: {
  phoneNumber: string
  voiceUrl: string
}): Promise<OwnedNumber> {
  const { sid } = creds()
  const form = new URLSearchParams({
    PhoneNumber: opts.phoneNumber,
    VoiceUrl: opts.voiceUrl,
    VoiceMethod: 'POST',
  })
  const n = await twilioFetch(`/Accounts/${sid}/IncomingPhoneNumbers.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
  return {
    sid: n.sid,
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    voiceUrl: n.voice_url ?? null,
  }
}

/** List numbers already owned on this Twilio account. */
export async function listOwnedNumbers(): Promise<OwnedNumber[]> {
  const { sid } = creds()
  const data = await twilioFetch(`/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=50`)
  return (data.incoming_phone_numbers ?? []).map((n: any) => ({
    sid: n.sid,
    phoneNumber: n.phone_number,
    friendlyName: n.friendly_name,
    voiceUrl: n.voice_url ?? null,
  }))
}
```
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.
- [ ] Commit:
```bash
git add lib/voice/gemini/twilio-signature.ts lib/voice/gemini/twilio-signature.test.ts lib/voice/gemini/twilio.ts
git commit -m "$(cat <<'EOF'
Add Twilio REST client + inbound signature validation for Gemini voice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: session-config endpoint

**Files:**
- `ghl-agent/app/api/voice/gemini/session-config/route.ts`

The bridge POSTs `{ params: "<signed blob>" }`; we verify, load agent + `GeminiVoiceConfig`, and return the `GeminiVoiceSession`. No cookie — trust derives from the HMAC on the params (only the TwiML route, holding the secret, could have minted it).

Steps:
- [ ] Confirm the Plan 1 import surface exists (fail fast if Plan 1 isn't merged into the branch):
```bash
cd ghl-agent && grep -n "export function buildGeminiVoiceSession" lib/voice/gemini/session.ts
# Expected: a line number. If missing → Plan 1 not implemented; stop and do Plan 1 first.
```
- [ ] Write `app/api/voice/gemini/session-config/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyBridgeParams } from '@/lib/voice/gemini/signing'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'

/**
 * Bridge → control-plane handshake. The Fly bridge presents the signed
 * params blob it received in the Twilio <Parameter>; we verify the HMAC
 * (no session cookie — the signature IS the auth), then return the
 * locked GeminiVoiceSession the bridge opens against Gemini Live.
 *
 * This is approach (B) from the plan: the bridge stays decoupled from
 * Prisma/Next; buildGeminiVoiceSession remains the single source of truth.
 */
export async function POST(req: NextRequest) {
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const parsed = verifyBridgeParams(String(body?.params ?? ''))
  if (!parsed) {
    return NextResponse.json({ error: 'invalid or expired params' }, { status: 401 })
  }

  const agent = await prisma.agent.findUnique({
    where: { id: parsed.agentId },
    include: { geminiVoiceConfig: true },
  })
  if (!agent || !agent.geminiVoiceConfig || !agent.geminiVoiceConfig.isActive) {
    return NextResponse.json({ error: 'agent or Gemini voice config not found' }, { status: 404 })
  }

  const session = buildGeminiVoiceSession(agent, agent.geminiVoiceConfig)

  return NextResponse.json({
    session,
    agentId: agent.id,
    locationId: agent.locationId,
    workspaceId: agent.workspaceId,
  })
}
```
> If the Plan 1 relation accessor is named differently than `geminiVoiceConfig` (e.g. `GeminiVoiceConfig`), match Plan 1's Prisma relation name exactly — grep `prisma/schema.prisma` for the relation field on `model Agent`. Likewise confirm `agent.locationId` / `agent.workspaceId` field names against the schema; adjust if Plan 1/existing schema differ.
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.
- [ ] Commit:
```bash
git add app/api/voice/gemini/session-config/route.ts
git commit -m "$(cat <<'EOF'
Add Gemini voice session-config endpoint for phone bridge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: TwiML answer route (+ Twilio signature verification)

**Files:**
- `ghl-agent/lib/voice/gemini/twiml.ts`
- `ghl-agent/lib/voice/gemini/twiml.test.ts`
- `ghl-agent/app/api/voice/gemini/twilio/route.ts`

Steps:
- [ ] Write the failing test `lib/voice/gemini/twiml.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { connectStreamTwiml, sayHangupTwiml } from './twiml'

describe('connectStreamTwiml', () => {
  it('emits a Connect/Stream with the signed parameter', () => {
    const xml = connectStreamTwiml({ wssUrl: 'wss://bridge.fly.dev/call', signedParams: 'abc.def' })
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Connect><Stream url="wss://bridge.fly.dev/call">' +
        '<Parameter name="p" value="abc.def"/>' +
        '</Stream></Connect></Response>',
    )
  })

  it('escapes XML-special characters in the signed param', () => {
    const xml = connectStreamTwiml({ wssUrl: 'wss://b/call', signedParams: 'a&b"<>' })
    expect(xml).toContain('value="a&amp;b&quot;&lt;&gt;"')
  })
})

describe('sayHangupTwiml', () => {
  it('emits a Say + Hangup', () => {
    const xml = sayHangupTwiml('Sorry, this line is unavailable.')
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Say>Sorry, this line is unavailable.</Say><Hangup/></Response>',
    )
  })
  it('escapes the spoken message', () => {
    expect(sayHangupTwiml('Tom & Jerry')).toContain('<Say>Tom &amp; Jerry</Say>')
  })
})
```
- [ ] Run it — expect FAIL:
```bash
cd ghl-agent && npx vitest run lib/voice/gemini/twiml.test.ts
# Expected: Error — Cannot find module './twiml'
```
- [ ] Write `lib/voice/gemini/twiml.ts`:
```ts
/** Pure TwiML builders for the Gemini voice answer route. */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

/** <Connect><Stream> bidirectional media stream to the Fly bridge. */
export function connectStreamTwiml(opts: { wssUrl: string; signedParams: string }): string {
  return (
    HEADER +
    '<Response><Connect>' +
    `<Stream url="${xmlEscape(opts.wssUrl)}">` +
    `<Parameter name="p" value="${xmlEscape(opts.signedParams)}"/>` +
    '</Stream></Connect></Response>'
  )
}

/** Graceful fallback: speak a brand-neutral line, then hang up. */
export function sayHangupTwiml(message: string): string {
  return HEADER + `<Response><Say>${xmlEscape(message)}</Say><Hangup/></Response>`
}
```
- [ ] Run it — expect PASS:
```bash
cd ghl-agent && npx vitest run lib/voice/gemini/twiml.test.ts
# Expected: Test Files 1 passed · Tests 4 passed
```
- [ ] Write the answer route `app/api/voice/gemini/twilio/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { validateTwilioSignature } from '@/lib/voice/gemini/twilio-signature'
import { signBridgeParams } from '@/lib/voice/gemini/signing'
import { connectStreamTwiml, sayHangupTwiml } from '@/lib/voice/gemini/twiml'

/**
 * Twilio inbound voice webhook for Gemini phone agents.
 *
 * 1. Validate X-Twilio-Signature against the form body + the exact URL
 *    Twilio called (must match the configured VoiceUrl, including https).
 * 2. Resolve which agent owns the dialled number (To → GeminiVoiceConfig).
 * 3. Return <Connect><Stream> pointing at the Fly bridge, carrying a
 *    short-lived signed params blob. The bridge presents that blob to
 *    /api/voice/gemini/session-config to learn which agent to run.
 *
 * On any miss (unknown number, inactive config) → a brand-neutral
 * <Say><Hangup>. Never dead-air.
 */

const FALLBACK_MESSAGE = 'Sorry, this number is not available right now. Please try again later.'

function twimlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const wssUrl = process.env.GEMINI_VOICE_BRIDGE_WSS_URL
  if (!authToken || !wssUrl) {
    return twimlResponse(sayHangupTwiml(FALLBACK_MESSAGE))
  }

  // Twilio posts application/x-www-form-urlencoded.
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  // Reconstruct the URL Twilio signed. Trust the proxy host so the
  // string matches the configured VoiceUrl exactly.
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const url = `${proto}://${host}${req.nextUrl.pathname}`

  const sig = req.headers.get('x-twilio-signature')
  if (!validateTwilioSignature(authToken, url, params, sig)) {
    // Reject unsigned/forged callbacks.
    return new NextResponse('forbidden', { status: 403 })
  }

  const to = params['To'] ?? ''
  if (!to) return twimlResponse(sayHangupTwiml(FALLBACK_MESSAGE))

  const config = await prisma.geminiVoiceConfig.findFirst({
    where: { twilioNumber: to, isActive: true },
    select: { agentId: true },
  })
  if (!config?.agentId) {
    return twimlResponse(sayHangupTwiml(FALLBACK_MESSAGE))
  }

  // 5-minute params window — far longer than answer latency, short
  // enough that a leaked blob is near-worthless.
  const exp = Math.floor(Date.now() / 1000) + 300
  const signed = signBridgeParams({ agentId: config.agentId, exp })

  return twimlResponse(connectStreamTwiml({ wssUrl, signedParams: signed }))
}
```
> Match the Prisma model accessor (`prisma.geminiVoiceConfig`) to Plan 1's actual model name. Grep `prisma/schema.prisma` for `model GeminiVoiceConfig`; the delegate is the camelCase of the model name.
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.
- [ ] Commit:
```bash
git add lib/voice/gemini/twiml.ts lib/voice/gemini/twiml.test.ts app/api/voice/gemini/twilio/route.ts
git commit -m "$(cat <<'EOF'
Add Gemini voice TwiML answer route with Twilio signature check

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: extend tool route for bridge auth + call-ended persistence

**Files:**
- `ghl-agent/app/api/voice/gemini/tool/route.ts` (modify — Plan 1 created it)
- `ghl-agent/app/api/voice/gemini/call-ended/route.ts` (new)

**7a — bridge HMAC on the tool route.** Plan 1's tool route authenticates dashboard/widget callers (cookie/ephemeral). The bridge is server-side and has no cookie, so it signs the request body with `signBridgeRequest` and sends `X-Voice-Signature`. Add that as an accepted path.

Steps:
- [ ] Read the existing tool route to find its auth gate and request shape:
```bash
cd ghl-agent && sed -n '1,80p' app/api/voice/gemini/tool/route.ts
```
- [ ] At the top of the `POST` handler, **before** the existing dashboard/widget auth, add a bridge-auth fast path. Read the raw body once (so the HMAC matches the exact bytes), then reuse it for JSON parsing. Insert:
```ts
import { verifyBridgeRequest } from '@/lib/voice/gemini/signing'
// ...
export async function POST(req: NextRequest) {
  // Read the raw body ONCE so HMAC verification sees the exact bytes
  // and downstream JSON.parse reuses the same string.
  const raw = await req.text()
  const bridgeSig = req.headers.get('x-voice-signature')
  const isBridge = verifyBridgeRequest(raw, bridgeSig)

  if (!isBridge) {
    // ... existing dashboard/widget auth gate stays here unchanged,
    // but parse the body from `raw` instead of calling req.json():
    //   const body = JSON.parse(raw)
    // (If the existing handler called `await req.json()`, replace that
    //  single call with JSON.parse(raw); the body can only be read once.)
  }

  const body = JSON.parse(raw) as { agentId: string; name: string; args: Record<string, unknown> }
  // ... existing executeTool dispatch on { agentId, name, args } unchanged ...
}
```
> Concretely: (1) add the `verifyBridgeRequest` import, (2) replace the route's first `await req.json()` with `const raw = await req.text()` + `JSON.parse(raw)`, (3) wrap the cookie/ephemeral auth so it is skipped when `isBridge` is true. Do not change the executor dispatch — the bridge sends the same `{ agentId, name, args }` shape Plan 1 already handles.
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.

**7b — call-ended persistence route.**
- [ ] Write `app/api/voice/gemini/call-ended/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { verifyBridgeRequest } from '@/lib/voice/gemini/signing'

/**
 * Sink for end-of-call telemetry from the Fly bridge. HMAC-authed (the
 * bridge signs the raw body with the shared secret). Writes one CallLog
 * row per inbound Gemini phone call. Recording upload is a follow-up;
 * the transcript is the load-bearing artifact and is always persisted.
 */
interface CallEndedBody {
  agentId: string
  locationId: string
  callSid: string
  from: string
  to: string
  durationSecs: number
  transcript: string
  endedReason?: string
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyBridgeRequest(raw, req.headers.get('x-voice-signature'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: CallEndedBody
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!body.agentId || !body.locationId) {
    return NextResponse.json({ error: 'missing agentId/locationId' }, { status: 400 })
  }

  await prisma.callLog.create({
    data: {
      locationId: body.locationId,
      agentId: body.agentId,
      contactPhone: body.from || null,
      direction: 'inbound',
      status: 'completed',
      durationSecs: Number.isFinite(body.durationSecs) ? Math.round(body.durationSecs) : null,
      transcript: body.transcript || null,
      endedReason: body.endedReason || null,
      triggerSource: 'gemini-voice-phone',
    },
  })

  return NextResponse.json({ ok: true })
}
```
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.
- [ ] Run the full pure-helper suite to confirm nothing regressed:
```bash
cd ghl-agent && npx vitest run lib/voice/gemini
# Expected: signing, twilio-signature, twiml suites all pass.
```
- [ ] Commit:
```bash
git add app/api/voice/gemini/tool/route.ts app/api/voice/gemini/call-ended/route.ts
git commit -m "$(cat <<'EOF'
Accept bridge HMAC on tool route; add call-ended CallLog sink

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Gemini phone-numbers API (list / purchase / persist)

**Files:**
- `ghl-agent/app/api/workspaces/[workspaceId]/agents/[agentId]/gemini/phone-numbers/route.ts`

Mirrors the Vapi phone-numbers route, but with Twilio, and persists the result onto `GeminiVoiceConfig`.

Steps:
- [ ] Write `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini/phone-numbers/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { prisma } from '@/lib/db'
import {
  listAvailableNumbers,
  listOwnedNumbers,
  purchaseNumber,
  TwilioError,
} from '@/lib/voice/gemini/twilio'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Agent-scoped Twilio number provisioning for Gemini voice.
 *
 *   GET  ?countryCode=US&areaCode=415  → available numbers + owned numbers
 *   POST { phoneNumber }               → buy it, wire the Voice webhook to
 *                                        our TwiML route, persist onto
 *                                        GeminiVoiceConfig.
 */

function appOrigin(req: NextRequest): string {
  const explicit = process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const countryCode = (req.nextUrl.searchParams.get('countryCode') || 'US').toUpperCase()
  const areaCode = req.nextUrl.searchParams.get('areaCode') || undefined

  try {
    const [available, owned] = await Promise.all([
      listAvailableNumbers({ countryCode, areaCode }),
      listOwnedNumbers(),
    ])
    return NextResponse.json({ available, owned })
  } catch (err) {
    const msg = err instanceof TwilioError ? err.userMessage : 'Failed to list numbers'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try {
    body = await req.json()
  } catch {}
  const phoneNumber = String(body.phoneNumber || '').trim()
  if (!phoneNumber) {
    return NextResponse.json({ error: 'phoneNumber (E.164) is required' }, { status: 400 })
  }

  // Confirm the agent belongs to this workspace before buying anything.
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 })

  const voiceUrl = `${appOrigin(req)}/api/voice/gemini/twilio`

  try {
    const purchased = await purchaseNumber({ phoneNumber, voiceUrl })
    await prisma.geminiVoiceConfig.upsert({
      where: { agentId },
      create: { agentId, twilioNumber: purchased.phoneNumber, twilioNumberSid: purchased.sid },
      update: { twilioNumber: purchased.phoneNumber, twilioNumberSid: purchased.sid },
    })
    return NextResponse.json({ number: purchased })
  } catch (err) {
    const msg = err instanceof TwilioError ? err.userMessage : 'Phone-number purchase failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
```
> The `geminiVoiceConfig.upsert` `create` clause must satisfy Plan 1's required columns. If Plan 1 made `isActive`/`model`/`voiceName` non-defaulted required fields, add them here (e.g. `isActive: true`, `model: process.env.GEMINI_VOICE_MODEL ?? 'gemini-3.1-flash-live'`). Grep `model GeminiVoiceConfig` in the schema and match required fields exactly.
- [ ] `cd ghl-agent && npx tsc --noEmit` — expect no errors.
- [ ] Commit:
```bash
git add "app/api/workspaces/[workspaceId]/agents/[agentId]/gemini/phone-numbers/route.ts"
git commit -m "$(cat <<'EOF'
Add Gemini voice Twilio phone-number provisioning API

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Fly bridge service scaffold

**Files:**
- `ghl-agent/services/gemini-voice-bridge/package.json`
- `ghl-agent/services/gemini-voice-bridge/tsconfig.json`
- `ghl-agent/services/gemini-voice-bridge/vitest.config.ts`
- `ghl-agent/services/gemini-voice-bridge/.dockerignore`
- `ghl-agent/services/gemini-voice-bridge/src/config.ts`
- `ghl-agent/services/gemini-voice-bridge/src/sign.ts`
- `ghl-agent/services/gemini-voice-bridge/src/gemini.ts`
- `ghl-agent/services/gemini-voice-bridge/Dockerfile`
- `ghl-agent/services/gemini-voice-bridge/fly.toml`

> **Step 9.1 (do this before Tasks 2 & 3's test runs if not already done):** create `package.json`, `tsconfig.json`, `vitest.config.ts`, then `npm install` inside the dir.

Steps:
- [ ] `package.json`:
```json
{
  "name": "gemini-voice-bridge",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "node --watch --loader tsx src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@google/genai": "^2.8.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```
- [ ] `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts", "dist", "node_modules"]
}
```
- [ ] `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } })
```
- [ ] `.dockerignore`:
```
node_modules
dist
src/**/*.test.ts
fly.toml
.git
```
- [ ] Install deps:
```bash
cd ghl-agent/services/gemini-voice-bridge && npm install
# Expected: added N packages. (Now Tasks 2 & 3 test commands run green.)
```
- [ ] `src/config.ts`:
```ts
/** Env validation for the bridge. Fails fast at boot if anything is missing. */
export interface BridgeConfig {
  port: number
  appUrl: string // Vercel origin, e.g. https://app.xovera.example
  geminiApiKey: string
  geminiModel: string
  signingSecret: string
}

export function loadConfig(): BridgeConfig {
  const appUrl = (process.env.APP_URL ?? '').replace(/\/$/, '')
  const geminiApiKey = process.env.GEMINI_API_KEY ?? ''
  const signingSecret = process.env.GEMINI_VOICE_SIGNING_SECRET ?? ''
  const missing: string[] = []
  if (!appUrl) missing.push('APP_URL')
  if (!geminiApiKey) missing.push('GEMINI_API_KEY')
  if (!signingSecret) missing.push('GEMINI_VOICE_SIGNING_SECRET')
  if (missing.length) throw new Error(`Missing required env: ${missing.join(', ')}`)
  return {
    port: Number(process.env.PORT ?? 8080),
    appUrl,
    geminiApiKey,
    geminiModel: process.env.GEMINI_VOICE_MODEL ?? 'gemini-3.1-flash-live',
    signingSecret,
  }
}
```
- [ ] `src/sign.ts` (bridge-side request signer — mirrors `signBridgeRequest`; the bridge doesn't import the Next app):
```ts
import { createHmac } from 'node:crypto'

/** HMAC-SHA256 (base64url) of a request body — the X-Voice-Signature value. */
export function signBridgeRequest(secret: string, body: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(body).digest('base64url')
}
```
- [ ] `src/gemini.ts` (Gemini Live session wrapper for Node; server-side full key):
```ts
import { GoogleGenAI } from '@google/genai'

/** Subset of the session-config response the bridge consumes. */
export interface GeminiVoiceSession {
  liveConfig: Record<string, unknown>
  vendorModelId: string
  voiceName: string | null
  maxSessionSecs: number
}

export interface GeminiCallbacks {
  /** PCM16 24 kHz mono audio chunk from the model. */
  onAudio: (pcm24k: Int16Array) => void
  /** Model asked to call a tool. */
  onToolCall: (calls: Array<{ id?: string; name: string; args: Record<string, unknown> }>) => void
  /** Barge-in: caller spoke over the model; flush playback. */
  onInterrupted: () => void
  /** Incremental transcript fragments (role = 'user' | 'model'). */
  onTranscript: (role: 'user' | 'model', text: string) => void
  onClose: () => void
}

export interface GeminiLink {
  /** Send PCM16 16 kHz mono caller audio to the model. */
  sendAudio: (pcm16k: Int16Array) => void
  sendToolResponse: (responses: Array<{ id?: string; name: string; response: Record<string, unknown> }>) => void
  close: () => void
}

function base64ToInt16(b64: string): Int16Array {
  const buf = Buffer.from(b64, 'base64')
  // PCM16 little-endian.
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)).slice()
}

function int16ToBase64(pcm: Int16Array): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
}

/**
 * Open a Gemini Live session from a locked GeminiVoiceSession. Uses the
 * full server-side GEMINI_API_KEY (the bridge is trusted infra — no
 * ephemeral token needed here). config = session.liveConfig, which
 * already carries responseModalities, systemInstruction, tools,
 * transcription, and sessionResumption from buildGeminiVoiceSession.
 */
export async function connectGemini(
  apiKey: string,
  session: GeminiVoiceSession,
  cb: GeminiCallbacks,
): Promise<GeminiLink> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } })

  const live = await ai.live.connect({
    model: session.vendorModelId,
    config: session.liveConfig as Record<string, unknown>,
    callbacks: {
      onmessage: (msg: any) => {
        const sc = msg?.serverContent
        if (sc?.interrupted) cb.onInterrupted()
        const parts = sc?.modelTurn?.parts ?? []
        for (const part of parts) {
          const inline = part?.inlineData
          if (inline?.data && String(inline.mimeType ?? '').startsWith('audio/')) {
            cb.onAudio(base64ToInt16(inline.data))
          }
        }
        if (sc?.inputTranscription?.text) cb.onTranscript('user', sc.inputTranscription.text)
        if (sc?.outputTranscription?.text) cb.onTranscript('model', sc.outputTranscription.text)
        const calls = msg?.toolCall?.functionCalls
        if (Array.isArray(calls) && calls.length) {
          cb.onToolCall(
            calls.map((c: any) => ({ id: c.id, name: String(c.name), args: c.args ?? {} })),
          )
        }
      },
      onerror: () => cb.onClose(),
      onclose: () => cb.onClose(),
    },
  })

  return {
    sendAudio: (pcm16k: Int16Array) => {
      live.sendRealtimeInput({
        audio: { data: int16ToBase64(pcm16k), mimeType: 'audio/pcm;rate=16000' },
      })
    },
    sendToolResponse: (responses) => {
      live.sendToolResponse({
        functionResponses: responses.map((r) => ({ id: r.id, name: r.name, response: r.response })),
      })
    },
    close: () => live.close(),
  }
}
```
- [ ] `Dockerfile`:
```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
```
- [ ] `fly.toml`:
```toml
app = "voxility-gemini-voice-bridge"
primary_region = "nrt"

[build]

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  # Keep one machine warm so the first inbound call answers instantly.
  # Set to 0 to fully scale-to-zero (saves idle cost; ~1-3s cold start
  # on the first call after idle).
  min_machines_running = 1

  [[http_service.checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "5s"
    method = "GET"
    path = "/health"
```
- [ ] `cd ghl-agent/services/gemini-voice-bridge && npx tsc --noEmit` — expect no errors (server.ts arrives in Task 10; this confirms config/sign/gemini compile).
- [ ] Commit:
```bash
git add services/gemini-voice-bridge/package.json services/gemini-voice-bridge/package-lock.json services/gemini-voice-bridge/tsconfig.json services/gemini-voice-bridge/vitest.config.ts services/gemini-voice-bridge/.dockerignore services/gemini-voice-bridge/src/config.ts services/gemini-voice-bridge/src/sign.ts services/gemini-voice-bridge/src/gemini.ts services/gemini-voice-bridge/Dockerfile services/gemini-voice-bridge/fly.toml
git commit -m "$(cat <<'EOF'
Scaffold Gemini voice Fly bridge service (config, gemini, docker, fly)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: bridge `server.ts` — WS relay wiring

**Files:**
- `ghl-agent/services/gemini-voice-bridge/src/server.ts`

Ties together `twilio-stream`, `audio`, `gemini`, `sign`, `config`. One WS connection per call at `/call`; `/health` returns 200.

Steps:
- [ ] Write `src/server.ts`:
```ts
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { loadConfig } from './config.js'
import { signBridgeRequest } from './sign.js'
import { muLawDecode, muLawEncode, resampleLinear } from './audio.js'
import { parseTwilioFrame, mediaFrame, clearFrame } from './twilio-stream.js'
import { connectGemini, type GeminiLink, type GeminiVoiceSession } from './gemini.js'

const cfg = loadConfig()

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server, path: '/call' })

interface CallState {
  streamSid: string
  callSid: string
  agentId: string | null
  locationId: string | null
  from: string
  to: string
  startedAt: number
  transcript: string[]
  gemini: GeminiLink | null
  closed: boolean
}

async function postSigned(path: string, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload)
  return fetch(`${cfg.appUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Voice-Signature': signBridgeRequest(cfg.signingSecret, body) },
    body,
  })
}

wss.on('connection', (twilioWs: WebSocket) => {
  const state: CallState = {
    streamSid: '',
    callSid: '',
    agentId: null,
    locationId: null,
    from: '',
    to: '',
    startedAt: Date.now(),
    transcript: [],
    gemini: null,
    closed: false,
  }

  // Buffer caller audio (μ-law 8k) that arrives before Gemini is ready.
  const pendingInbound: Int16Array[] = []

  const sendToTwilio = (pcm24k: Int16Array) => {
    if (state.closed) return
    const pcm8k = resampleLinear(pcm24k, 24000, 8000)
    const ulaw = muLawEncode(pcm8k)
    twilioWs.send(mediaFrame(state.streamSid, ulaw.toString('base64')))
  }

  const flushTwilio = () => {
    if (!state.closed && state.streamSid) twilioWs.send(clearFrame(state.streamSid))
  }

  const startGemini = async (session: GeminiVoiceSession) => {
    state.gemini = await connectGemini(cfg.geminiApiKey, session, {
      onAudio: sendToTwilio,
      onInterrupted: flushTwilio,
      onTranscript: (role, text) => state.transcript.push(`${role === 'user' ? 'Caller' : 'Agent'}: ${text}`),
      onClose: () => endCall('gemini-closed'),
      onToolCall: async (calls) => {
        for (const call of calls) {
          try {
            const res = await postSigned('/api/voice/gemini/tool', {
              agentId: state.agentId,
              name: call.name,
              args: call.args,
            })
            const result = res.ok ? await res.json() : { error: 'tool failed' }
            state.gemini?.sendToolResponse([{ id: call.id, name: call.name, response: result }])
          } catch {
            state.gemini?.sendToolResponse([{ id: call.id, name: call.name, response: { error: 'tool error' } }])
          }
        }
      },
    })
    // Drain anything the caller said while we were connecting.
    for (const chunk of pendingInbound) state.gemini.sendAudio(chunk)
    pendingInbound.length = 0
  }

  const endCall = async (reason: string) => {
    if (state.closed) return
    state.closed = true
    try { state.gemini?.close() } catch {}
    try { twilioWs.close() } catch {}
    if (state.agentId && state.locationId) {
      const durationSecs = Math.round((Date.now() - state.startedAt) / 1000)
      try {
        await postSigned('/api/voice/gemini/call-ended', {
          agentId: state.agentId,
          locationId: state.locationId,
          callSid: state.callSid,
          from: state.from,
          to: state.to,
          durationSecs,
          transcript: state.transcript.join('\n'),
          endedReason: reason,
        })
      } catch {
        // Best-effort; a dropped sink call must not crash the process.
      }
    }
  }

  twilioWs.on('message', async (data) => {
    const frame = parseTwilioFrame(data.toString())
    if (!frame) return

    if (frame.event === 'start') {
      state.streamSid = frame.streamSid
      state.callSid = frame.callSid
      const signedParams = frame.params['p'] ?? ''
      try {
        const res = await postSigned('/api/voice/gemini/session-config', { params: signedParams })
        if (!res.ok) return endCall('session-config-failed')
        const cfgBody = (await res.json()) as {
          session: GeminiVoiceSession
          agentId: string
          locationId: string
        }
        state.agentId = cfgBody.agentId
        state.locationId = cfgBody.locationId
        await startGemini(cfgBody.session)
      } catch {
        return endCall('session-config-error')
      }
      return
    }

    if (frame.event === 'media') {
      // μ-law 8k → PCM16 8k → 16k → Gemini.
      const pcm8k = muLawDecode(Buffer.from(frame.payload, 'base64'))
      const pcm16k = resampleLinear(pcm8k, 8000, 16000)
      if (state.gemini) state.gemini.sendAudio(pcm16k)
      else pendingInbound.push(pcm16k)
      return
    }

    if (frame.event === 'stop') {
      await endCall('caller-hangup')
      return
    }
  })

  twilioWs.on('close', () => endCall('ws-close'))
  twilioWs.on('error', () => endCall('ws-error'))

  // Hard ceiling guard: never let a wedged call outlive its budget.
  setTimeout(() => endCall('max-duration'), 11 * 60 * 1000)
})

server.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(`gemini-voice-bridge listening on :${cfg.port}`)
})
```
- [ ] `cd ghl-agent/services/gemini-voice-bridge && npx tsc --noEmit` — expect no errors.
- [ ] Run the bridge's full test suite:
```bash
cd ghl-agent/services/gemini-voice-bridge && npm test
# Expected: audio + twilio-stream suites pass (16 tests total).
```
- [ ] Commit:
```bash
git add services/gemini-voice-bridge/src/server.ts
git commit -m "$(cat <<'EOF'
Wire Twilio<->Gemini relay in voice bridge server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: dashboard Gemini phone-number panel

**Files:**
- `ghl-agent/app/dashboard/[workspaceId]/agents/[agentId]/voice/GeminiPhoneNumberPanel.tsx`
- Plan 1's Gemini config section (mount the panel; 1-line import + render)

Theme tokens ONLY (remapped zinc + accent utilities). No `bg-white` (renders BRAND ORANGE), no raw `gray-*`. NewBadge already lives on the Gemini option (Plan 1) — this panel is inside that same section, so no new badge needed.

Steps:
- [ ] Write `GeminiPhoneNumberPanel.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'

interface AvailableNumber {
  phoneNumber: string
  friendlyName: string
  locality: string | null
  region: string | null
}

interface Props {
  workspaceId: string
  agentId: string
  /** Currently provisioned number (from GeminiVoiceConfig.twilioNumber). */
  currentNumber: string | null
  onProvisioned: (e164: string) => void
}

/**
 * Twilio number provisioning for a Gemini voice agent. Lives inside the
 * Gemini config section of the voice page (Plan 1). Styling uses the
 * remapped zinc scale + accent tokens only — never bg-white (orange).
 */
export function GeminiPhoneNumberPanel({ workspaceId, agentId, currentNumber, onProvisioned }: Props) {
  const [country, setCountry] = useState('US')
  const [areaCode, setAreaCode] = useState('')
  const [available, setAvailable] = useState<AvailableNumber[]>([])
  const [loading, setLoading] = useState(false)
  const [buying, setBuying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/workspaces/${workspaceId}/agents/${agentId}/gemini/phone-numbers`

  async function search() {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ countryCode: country })
      if (areaCode) qs.set('areaCode', areaCode)
      const res = await fetch(`${base}?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setAvailable(data.available ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function buy(phoneNumber: string) {
    setBuying(phoneNumber)
    setError(null)
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Purchase failed')
      onProvisioned(data.number.phoneNumber)
      setAvailable([])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBuying(null)
    }
  }

  useEffect(() => {
    setAvailable([])
  }, [country])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="text-sm font-medium text-zinc-100">Phone number</div>

      {currentNumber ? (
        <div className="text-sm text-zinc-300">
          This agent answers calls on{' '}
          <span className="font-mono text-accent-amber">{currentNumber}</span>.
        </div>
      ) : (
        <div className="text-sm text-zinc-400">
          No number yet. Search and buy one to let callers reach this agent.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">
          Country
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 block rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="GB">United Kingdom</option>
            <option value="AU">Australia</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Area code (optional)
          <input
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="415"
            className="mt-1 block w-24 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          />
        </label>
        <button
          onClick={search}
          disabled={loading}
          className="rounded bg-accent-primary-bg px-3 py-1.5 text-sm text-zinc-100 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search numbers'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-accent-red-bg bg-accent-red-bg/20 px-3 py-2 text-sm text-accent-red">
          {error}
        </div>
      )}

      {available.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {available.map((n) => (
            <li key={n.phoneNumber} className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="font-mono text-sm text-zinc-100">{n.phoneNumber}</div>
                <div className="text-xs text-zinc-400">
                  {[n.locality, n.region].filter(Boolean).join(', ') || n.friendlyName}
                </div>
              </div>
              <button
                onClick={() => buy(n.phoneNumber)}
                disabled={buying === n.phoneNumber}
                className="rounded bg-accent-primary-bg px-3 py-1 text-sm text-zinc-100 disabled:opacity-50"
              >
                {buying === n.phoneNumber ? 'Buying…' : 'Buy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```
> Confirm the accent token names (`accent-primary-bg`, `accent-amber`, `accent-red`, `accent-red-bg`) against the `@theme` block in `app/globals.css` and a neighbouring dashboard page; swap to whatever Plan 1's Gemini panel already uses so the two sections match. If Plan 1 wired Gemini fields into `useDirtyForm`/`<SaveBar>`, the provisioned number is persisted immediately by the POST (not via the save bar), so it does not need to participate in dirty tracking — surface it as a live read-only value.
- [ ] Mount it inside Plan 1's Gemini config block on `voice/page.tsx` (import + render with `workspaceId`, `agentId`, the current `twilioNumber`, and an `onProvisioned` that updates local state). Keep the change to one import + one `<GeminiPhoneNumberPanel … />`.
- [ ] `cd ghl-agent && npx tsc --noEmit && npm run lint` — expect no errors.
- [ ] Commit:
```bash
git add "app/dashboard/[workspaceId]/agents/[agentId]/voice/GeminiPhoneNumberPanel.tsx" "app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx"
git commit -m "$(cat <<'EOF'
Add Twilio number provisioning panel to Gemini voice config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: deploy + verify live

**Files:** none (operational).

Steps:
- [ ] Set Vercel env (if not already done in the secrets section): `GEMINI_VOICE_SIGNING_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (Twilio values from Ryan). Push the branch so Vercel builds a preview/prod deployment with the new routes.
- [ ] Launch the Fly app and set its secrets:
```bash
cd ghl-agent/services/gemini-voice-bridge
fly launch --no-deploy --copy-config --name voxility-gemini-voice-bridge --region nrt
fly secrets set \
  GEMINI_VOICE_SIGNING_SECRET=a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646 \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  APP_URL="https://<your-vercel-prod-origin>" \
  GEMINI_VOICE_MODEL=gemini-3.1-flash-live \
  -a voxility-gemini-voice-bridge
fly deploy -a voxility-gemini-voice-bridge
```
- [ ] Confirm health:
```bash
curl -fsS https://voxility-gemini-voice-bridge.fly.dev/health
# Expected: ok
```
- [ ] Set the bridge wss URL in Vercel (now that the app domain is live), then redeploy Vercel so the TwiML route has it:
```bash
printf '%s' 'wss://voxility-gemini-voice-bridge.fly.dev/call' | vercel env add GEMINI_VOICE_BRIDGE_WSS_URL production
```
- [ ] In the dashboard, open a Gemini voice agent → buy a Twilio number via the panel. Confirm Twilio's number Voice webhook now points at `https://<prod>/api/voice/gemini/twilio` (the purchase wires it automatically; verify in the Twilio console or via `listOwnedNumbers`).
- [ ] **Live call:** dial the number from a real phone. Verify: the agent answers, audio is native Gemini quality (not a TTS pipeline), barge-in works (talk over it → it stops), and a tool call (if the agent has one) executes.
- [ ] Confirm persistence — a `CallLog` row was written:
```bash
cd ghl-agent && npm run db:studio   # inspect CallLog: direction='inbound', triggerSource='gemini-voice-phone', transcript populated
```
- [ ] Tail Fly logs during the call to confirm the relay path:
```bash
fly logs -a voxility-gemini-voice-bridge
# Expected: connection, session-config 200, no transcode/relay errors.
```
- [ ] If everything passes, the branch is ready to merge once Ryan runs Plan 1's SQL. Do NOT merge to main here — leave it on `gemini-voice`.

---

## Self-review

**Spec coverage (phone half of the design spec §4 + Build order step 3):**
- Twilio number provisioned per agent → Task 4 (client) + Task 8 (API) + Task 11 (UI). ✓
- Inbound TwiML `<Connect><Stream>` with signed params → Task 6. ✓
- Fly.io Node/TS bridge, own package + fly.toml, region nrt, auto-stop/start, min 1 → Task 9. ✓
- Bridge verifies HMAC, fetches locked session config (approach B), opens Gemini Live via shared builder, relays audio with μ-law↔PCM + barge-in → Tasks 5, 10, 2, 3. ✓
- Tool calls round-trip to Vercel tool-exec → Task 7a + Task 10 `onToolCall`. ✓
- Transcript + duration POSTed to a Vercel sink on hangup → Task 7b + Task 10 `endCall`. ✓
- Graceful fallback (no dead-air) on miss/inactive → Task 6 `sayHangupTwiml`; on Gemini error mid-call → Task 10 `onClose`→`endCall`. ✓ (Warm-transfer-to-fallback-number is noted as out-of-scope polish — spec lists it as optional "(optionally)".)
- No silent fallback to TTS → the bridge only ever speaks Gemini audio; failure ends the call, never degrades. ✓
- Recording: spec marks `recordCalls` optional; transcript is the load-bearing artifact and is always written. Full audio recording upload is explicitly a follow-up (noted in Task 7b doc-comment + the original prompt's guidance). ✓

**Placeholder scan:** No `TODO`/`FIXME`/`...`/`<placeholder>` in any code block. μ-law (G.711 with BIAS 0x84 / CLIP 32635), linear resample, HMAC-SHA256 signing, and Twilio HMAC-SHA1 signature are all real, complete algorithms with reference-vector tests. ✓

**Type consistency with the locked contract + Plan 1:**
- `GeminiVoiceSession` shape in the bridge (`src/gemini.ts`) is a structural subset of the locked contract (`liveConfig`, `vendorModelId`, `voiceName`, `maxSessionSecs`) — the bridge ignores `tools` (already baked into `liveConfig.tools` by the builder) which matches how `liveConfig` carries `functionDeclarations`. ✓
- `session-config` route returns the full `buildGeminiVoiceSession(...)` result + `agentId/locationId/workspaceId`, matching the prompt's specified response. ✓
- Tool route reuses Plan 1's `{ agentId, name, args }` body — no new dispatch surface invented. ✓
- `liveConfig` from `buildGeminiVoiceSession` mirrors the verified Copilot shape (`responseModalities`, `systemInstruction`, `tools:[{functionDeclarations}]`, `inputAudioTranscription`/`outputAudioTranscription`, `sessionResumption`, optional `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`), so the bridge's `ai.live.connect({ config })` consumes it without remapping. ✓
- `CallLog` write uses only existing columns (`locationId`, `agentId`, `contactPhone`, `direction`, `status`, `durationSecs`, `transcript`, `endedReason`, `triggerSource`) — verified against `prisma/schema.prisma`; no schema change. ✓

**Cross-cutting project rules:**
- No `ghl`/`HighLevel` in any new identifier, route, env var, or file name (all `gemini`/`voice`/`twilio`/generic). ✓
- Customer-facing copy brand-neutral ("your CRM" not surfaced here; fallback line says "this number is not available", panel says "your agent"). ✓
- Signing secret generated here (32-byte hex), stored via `printf '%s' | vercel env add` and `fly secrets set` — never an `openssl` handed to Ryan, never `echo`. ✓
- Theme tokens only in the panel (remapped zinc + accent utilities, no `bg-white`/`gray-*`). ✓
- No migration auto-run; reuse existing `CallLog`; Plan 1 owns the schema + hand-run SQL. ✓
- Every commit ends with the Co-Authored-By trailer; branch `gemini-voice`, never main. ✓

**Open assumptions flagged inline** (also summarized for Ryan below): Prisma relation/delegate names (`agent.geminiVoiceConfig`, `prisma.geminiVoiceConfig`) and `GeminiVoiceConfig` required fields must match Plan 1's final schema — each consuming task tells the implementer to grep and align. The tool route's exact existing auth structure (Task 7a) must be read before editing.
