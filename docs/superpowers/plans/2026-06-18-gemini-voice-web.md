# Gemini Voice Agents — Web Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Gemini as a native **speech-to-speech** voice runtime to the Voxility app, web (in-browser) surface only, plus the runtime-agnostic shared core that Plan 2 (phone, Fly.io/Twilio bridge) builds on. An operator picks "Gemini — native voice" on an agent's voice page, configures a prebuilt voice + first/end message, and runs a "Test voice" call in the browser; the public chat widget routes a visitor voice call to the same Gemini Live runtime. Tool calls round-trip through the existing agent executor; transcripts persist on the existing `CallLog` / `WidgetVoiceCall` rows.

**Architecture:** Gemini is a *new top-level voice runtime*, a sibling to (not an engine inside) the existing Vapi pipeline. An `Agent.voiceRuntime` discriminator (`'vapi' | 'gemini'`) plus a sibling `GeminiVoiceConfig` table hold the choice. A pure, runtime-agnostic session builder (`lib/voice/gemini/session.ts`, **no next/prisma imports** — Plan 2's Fly bridge imports it directly) composes the Gemini Live `liveConfig` (system instruction from the agent prompt + brand-neutral voice guardrails, tool declarations mapped from the agent's CRM tool catalogue, voice/language/duration). A thin server mint (`lib/voice/gemini/mint.ts`) turns that into a Google ephemeral token, reusing the exact pattern from `lib/copilot/session-service.ts`. The browser reuses `GeminiLiveProvider` (`lib/copilot/providers/gemini-live.ts`) and the audio plumbing (`lib/copilot/audio-client.ts`) **as-is** — both already ship for Copilot. Routes own auth; the shared core owns everything else.

**Tech Stack:** Next.js 16 (App Router, **not** your training data — consult `node_modules/next/dist/docs/` before writing route handlers), React 19, Prisma 7 on Postgres (Seoul/icn1), `@google/genai` ^2.8.0 (already a dependency), Vitest for pure-helper unit tests under `lib/**/*.test.ts`. Theme tokens only (CSS vars from `app/globals.css`; `bg-white` renders BRAND ORANGE — never use it).

**Branch:** All work happens on a feature branch `gemini-voice` (cut from `main`). Do **not** commit to `main`. The hand-run SQL (Task 1) is applied by Ryan against the Seoul prod DB before the branch merges.

**Project rules baked in:**
- Migrations are **hand-run SQL by Ryan**. Task 1 ships the exact `ALTER TABLE` / `CREATE TABLE` SQL as a code block; the Prisma migration is created locally only (`npm run db:migrate -- --name add_gemini_voice_config`) to keep the schema/client in sync. Never auto-run destructive migrations; never block a deploy on schema state.
- No `ghl` / `HighLevel` / `GHL` in any new identifier — use `gemini` / `voice` / generic CRM terms.
- Brand-neutral customer copy: "your CRM", never "HighLevel"/"GHL".
- Theme tokens only; copy classes/inline-style patterns from the existing voice page (`var(--surface)`, `var(--border)`, `var(--text-primary)`, `#fa4d2e` for active accent).
- `<NewBadge since="2026-06-18" />` on the new Gemini option (component `components/NewBadge.tsx`, prop `since: string` — inline per feature; there is no central ship-dates object).
- Route handlers + anything touching Prisma/`@google/genai` are **NOT** unit-tested (project convention) — verified manually/live. Only pure helpers under `lib/**/*.test.ts` run in vitest.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Locked shared-core contract (Plan 2 depends on these EXACT signatures — do not rename):**
```ts
// lib/voice/gemini/session.ts — runtime-agnostic, NO next/prisma imports
import type { RealtimeToolDef } from '@/lib/copilot/types'
export interface GeminiVoiceSession {
  liveConfig: Record<string, unknown>
  tools: RealtimeToolDef[]
  vendorModelId: string
  voiceName: string | null
  maxSessionSecs: number
}
export function buildGeminiVoiceSession(
  agent: { name: string; systemPrompt: string; instructions: string | null; enabledTools: string[]; locationId: string; workspaceId: string | null; agentId: string },
  config: { voiceName: string | null; model: string; firstMessage: string | null; endCallMessage: string | null; language: string | null; maxDurationSecs: number },
  opts?: { ragContext?: string; locale?: string },
): GeminiVoiceSession
export function agentToolsToRealtimeDefs(enabledTools: string[]): RealtimeToolDef[]
// lib/voice/gemini/mint.ts (server; imports @google/genai)
export function mintGeminiVoiceToken(s: GeminiVoiceSession): Promise<{ token: string; vendorModelId: string; maxSessionSecs: number }>
```

---

## File Structure

| Path | Create/Modify | Responsibility |
| --- | --- | --- |
| `prisma/schema.prisma` | Modify | Add `Agent.voiceRuntime String? @default("vapi")`, add `Agent.geminiVoiceConfig GeminiVoiceConfig?` back-relation, add new `GeminiVoiceConfig` model (1:1 on Agent). |
| `lib/voice/gemini/voice-config.ts` | Create | Tiny default-config helper (the `config` arg shape for `buildGeminiVoiceSession`) so routes and tests share one default. No prisma/next imports. |
| `lib/voice/gemini-native-voices.ts` | Create | Static Gemini prebuilt-voice catalogue (`GEMINI_NATIVE_VOICES: VoiceOption[]`, `GEMINI_NATIVE_VOICE_IDS`, `GEMINI_DEFAULT_VOICE_ID`, `getGeminiVoice(id)`). Mirrors `vapi-native-voices.ts`. |
| `lib/voice/gemini-native-voices.test.ts` | Test | Catalogue shape + lookup. |
| `lib/voice/gemini/tool-defs.ts` | Create | `agentToolsToRealtimeDefs(enabledTools)` — filters `AGENT_TOOLS` and maps `input_schema` → `RealtimeToolDef.parameters`. Pure. |
| `lib/voice/gemini/tool-defs.test.ts` | Test | Filtering + schema-mapping. |
| `lib/voice/gemini/session.ts` | Create | **The core.** `buildGeminiVoiceSession(...)` + re-export `agentToolsToRealtimeDefs`. Runtime-agnostic, no next/prisma. Holds the `toGeminiLiveConfig` builder (mirrors the Copilot liveConfig shape). |
| `lib/voice/gemini/session.test.ts` | Test | Prompt composition, guardrail block, tool wiring, voice/duration locking. |
| `lib/voice/gemini/mint.ts` | Create | Server-only `mintGeminiVoiceToken(session)` — `@google/genai` ephemeral token, reuses the Copilot mint pattern. |
| `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/route.ts` | Create | GET (load/default `GeminiVoiceConfig`) + PUT (upsert; set `Agent.voiceRuntime`). Mirrors the vapi route, `requireWorkspaceAccess`. |
| `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/token/route.ts` | Create | POST — dashboard web token mint. Returns `RealtimeProviderConfig`-shaped body. |
| `app/api/voice/gemini/tool/route.ts` | Create | POST `{ agentId, name, args }` — server resolves `locationId`, runs `executeTool(...)`, returns `{ result }`. Dashboard-gated by `requireWorkspaceAccess`; public widget path uses widget auth. |
| `app/api/voice/gemini/transcript/route.ts` | Create | POST — persist accumulated transcript turns + duration on call end (`CallLog` for dashboard, `WidgetVoiceCall` for widget). |
| `app/api/widget/[widgetId]/gemini-voice/token/route.ts` | Create | POST — public scoped Gemini token mint for the chat widget (widget auth + abuse guard). Creates the `WidgetVoiceCall` row. |
| `app/api/voices/route.ts` | Modify | Add `provider === 'gemini'` branch returning the Gemini catalogue in the existing wire shape. |
| `app/api/voices/route.gemini-filter.test.ts` | Test | Pure filter helper for the gemini search branch. |
| `lib/voice/gemini/voices-wire.ts` | Create | `filterGeminiVoices(search?)` + `toVoiceWire(v)` — the pure mapping the route + its test share. |
| `app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx` | Modify | Add a top-level **runtime picker** above the existing engine tabs; render a Gemini config panel + "Test voice" (browser GeminiLiveProvider) when Gemini is selected. `<NewBadge since="2026-06-18" />`. |
| `components/voice/GeminiVoicePanel.tsx` | Create | The Gemini config panel + Test-voice client component (voice catalogue browse/preview, first/end message, language, mic call). Keeps the page's current save mechanism. |
| `app/widget/[widgetId]/embed/page.tsx` | Modify | Wire GeminiLiveProvider into the existing `voiceOpen/voiceState/...` scaffolding when the widget's agent has `voiceRuntime==='gemini'`. |
| `services/gemini-voice-bridge/` | (Plan 2) | NOT in this plan — phone bridge. |

---

### Task 1: Branch, Prisma schema, hand-run SQL

**Files:**
- Modify: `prisma/schema.prisma`
- (Local-only) Prisma migration under `prisma/migrations/*_add_gemini_voice_config/`

- [ ] Cut the feature branch from main:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git checkout main && git pull && git checkout -b gemini-voice
  ```
  Expected: `Switched to a new branch 'gemini-voice'`.

- [ ] Open `prisma/schema.prisma` and locate the `Agent` model (~line 567). Find the existing relation line `vapiConfig           VapiConfig?` (~line 713). Add the runtime discriminator and the new back-relation immediately after it. Replace:
  ```prisma
  vapiConfig           VapiConfig?
  ```
  with:
  ```prisma
  vapiConfig           VapiConfig?
  // Voice runtime discriminator: 'vapi' (today's telephony pipeline) vs
  // 'gemini' (native speech-to-speech, web + phone). Authoritative for
  // which config table the dashboard + inbound router read. Nullable +
  // defaults to 'vapi' so every existing agent stays on Vapi untouched.
  voiceRuntime         String?     @default("vapi")
  geminiVoiceConfig    GeminiVoiceConfig?
  ```

- [ ] In the same file, add the new model. Put it directly AFTER the closing `}` of the `VapiConfig` model (keep voice-config models adjacent):
  ```prisma
  // Native Gemini speech-to-speech voice config. Sibling to VapiConfig
  // (1:1 on Agent), NOT nullable columns on VapiConfig — VapiConfig is
  // Vapi-specific (vapiAssistantId, ElevenLabs tuning). Gemini bypasses
  // Vapi entirely. twilioNumber* are reserved for the Plan-2 phone path
  // (provisioned via Twilio, not Vapi); the web runtime ignores them.
  model GeminiVoiceConfig {
    id              String   @id @default(cuid())
    agentId         String   @unique
    agent           Agent    @relation(fields: [agentId], references: [id], onDelete: Cascade)
    isActive        Boolean  @default(false)
    // Gemini prebuilt voice id (e.g. 'Puck', 'Kore'). null = model default.
    voiceName       String?
    // Native-audio model id, env-overridable (GEMINI_VOICE_MODEL).
    model           String   @default("gemini-3.1-flash-live")
    firstMessage    String?  @db.Text
    endCallMessage  String?  @db.Text
    maxDurationSecs Int      @default(600)
    recordCalls     Boolean  @default(true)
    language        String?
    // Plan-2 phone path (Twilio carrier — provisioned outside Vapi).
    twilioNumberSid String?
    twilioNumber    String?
    createdAt       DateTime @default(now())
    updatedAt       DateTime @updatedAt
  }
  ```

- [ ] Generate the Prisma migration + client locally (this does NOT touch prod — it writes the local migration file and regenerates `@prisma/client`):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npm run db:migrate -- --name add_gemini_voice_config
  ```
  Expected: a new folder `prisma/migrations/<timestamp>_add_gemini_voice_config/migration.sql`, and `✔ Generated Prisma Client`. If the local DB is unreachable, run `npx prisma generate` to at least refresh the client so the new `db.geminiVoiceConfig` type exists, and still commit the schema change.

- [ ] Confirm the generated client typechecks:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors (the new `db.geminiVoiceConfig` delegate + `Agent.voiceRuntime` field resolve).

- [ ] **Hand-run SQL for Ryan.** This is the SQL Ryan runs by hand against the Seoul prod DB before the branch merges. It is idempotent-friendly (`IF NOT EXISTS`). Add it to the PR description AND paste it here in the plan so it is not lost:
  ```sql
  -- Gemini native voice runtime (web + phone). Hand-run before merge.
  ALTER TABLE "Agent"
    ADD COLUMN IF NOT EXISTS "voiceRuntime" TEXT DEFAULT 'vapi';

  CREATE TABLE IF NOT EXISTS "GeminiVoiceConfig" (
    "id"              TEXT NOT NULL,
    "agentId"         TEXT NOT NULL,
    "isActive"        BOOLEAN NOT NULL DEFAULT false,
    "voiceName"       TEXT,
    "model"           TEXT NOT NULL DEFAULT 'gemini-3.1-flash-live',
    "firstMessage"    TEXT,
    "endCallMessage"  TEXT,
    "maxDurationSecs" INTEGER NOT NULL DEFAULT 600,
    "recordCalls"     BOOLEAN NOT NULL DEFAULT true,
    "language"        TEXT,
    "twilioNumberSid" TEXT,
    "twilioNumber"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeminiVoiceConfig_pkey" PRIMARY KEY ("id")
  );

  CREATE UNIQUE INDEX IF NOT EXISTS "GeminiVoiceConfig_agentId_key"
    ON "GeminiVoiceConfig"("agentId");

  ALTER TABLE "GeminiVoiceConfig"
    ADD CONSTRAINT "GeminiVoiceConfig_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  ```
  > Note for Ryan: the `ADD CONSTRAINT ... fkey` will error if re-run (Postgres has no `IF NOT EXISTS` for named constraints pre-PG16). If re-applying, drop it first or skip that statement. Do NOT wire this into `scripts/prisma-migrate.mjs` — it stays manual per project rule.

- [ ] Commit (schema + local migration only):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add prisma/schema.prisma prisma/migrations && git commit -m "$(cat <<'EOF'
  Add GeminiVoiceConfig model + Agent.voiceRuntime discriminator

  Sibling table to VapiConfig (1:1 on Agent) for the native Gemini
  speech-to-speech runtime. voiceRuntime defaults to 'vapi' so existing
  agents are untouched. Prod SQL is hand-run by Ryan (in PR body).

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Gemini native-voice catalogue

**Files:**
- Create: `lib/voice/gemini-native-voices.ts`
- Test: `lib/voice/gemini-native-voices.test.ts`

- [ ] Write the failing test first. Create `lib/voice/gemini-native-voices.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import {
    GEMINI_NATIVE_VOICES,
    GEMINI_NATIVE_VOICE_IDS,
    GEMINI_DEFAULT_VOICE_ID,
    getGeminiVoice,
  } from './gemini-native-voices'

  describe('gemini-native-voices', () => {
    it('exposes the real Gemini prebuilt voice ids', () => {
      expect(GEMINI_NATIVE_VOICE_IDS).toEqual([
        'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr',
      ])
    })

    it('every voice is a well-formed VoiceOption with a description + gender label', () => {
      expect(GEMINI_NATIVE_VOICES).toHaveLength(GEMINI_NATIVE_VOICE_IDS.length)
      for (const v of GEMINI_NATIVE_VOICES) {
        expect(v.id).toBe(v.name)
        expect(v.language).toBe('en')
        expect(v.previewUrl).toBeNull()
        expect(v.labels?.description?.length).toBeGreaterThan(0)
        expect(['male', 'female']).toContain(v.labels?.gender)
      }
    })

    it('default voice is in the catalogue', () => {
      expect(GEMINI_NATIVE_VOICE_IDS).toContain(GEMINI_DEFAULT_VOICE_ID)
    })

    it('getGeminiVoice is case-insensitive and returns null for unknowns', () => {
      expect(getGeminiVoice('puck')?.id).toBe('Puck')
      expect(getGeminiVoice('Kore')?.id).toBe('Kore')
      expect(getGeminiVoice('Nope')).toBeNull()
      expect(getGeminiVoice('')).toBeNull()
    })
  })
  ```

- [ ] Run it — expect FAIL (module does not exist yet):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini-native-voices.test.ts
  ```
  Expected: `Error: Failed to load url ./gemini-native-voices` / `No test files found` style failure (the import cannot resolve). Confirmed RED.

- [ ] Create `lib/voice/gemini-native-voices.ts` (complete):
  ```ts
  /**
   * Gemini native-audio prebuilt voice catalogue.
   *
   * Gemini Live exposes a fixed set of prebuilt voices selected via
   * speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName. The list is
   * hardcoded here (like vapi-native-voices.ts) because it changes rarely
   * and a static list lets the picker populate instantly with no failure
   * modes. Casing matters — Gemini expects the exact capitalized token.
   *
   * previewUrl is null: Gemini has no public one-shot TTS endpoint, so
   * operators audit each voice via the "Test voice" panel (same as the
   * Vapi-native voices). Gender/description are best-effort from Google's
   * voice material; operators verify by ear.
   */

  import type { VoiceOption } from './types'

  export const GEMINI_DEFAULT_VOICE_ID = 'Puck'

  export const GEMINI_NATIVE_VOICE_IDS = [
    'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr',
  ] as const

  export type GeminiNativeVoiceId = typeof GEMINI_NATIVE_VOICE_IDS[number]

  const VOICE_META: Record<GeminiNativeVoiceId, { gender: 'male' | 'female'; description: string }> = {
    Puck:   { gender: 'male',   description: 'Upbeat, energetic. A friendly default.' },
    Charon: { gender: 'male',   description: 'Deep, measured, authoritative.' },
    Kore:   { gender: 'female', description: 'Warm, clear, professional.' },
    Fenrir: { gender: 'male',   description: 'Bright, confident, direct.' },
    Aoede:  { gender: 'female', description: 'Smooth, expressive, natural.' },
    Leda:   { gender: 'female', description: 'Soft, calm, reassuring.' },
    Orus:   { gender: 'male',   description: 'Steady, grounded, even-toned.' },
    Zephyr: { gender: 'female', description: 'Light, breezy, approachable.' },
  }

  export const GEMINI_NATIVE_VOICES: VoiceOption[] = GEMINI_NATIVE_VOICE_IDS.map(id => ({
    id,
    name: id,
    language: 'en',
    labels: VOICE_META[id],
    previewUrl: null,
  }))

  /** Case-insensitive lookup; returns null for unknown / empty ids. */
  export function getGeminiVoice(voiceId: string): VoiceOption | null {
    if (!voiceId) return null
    const target = voiceId.toLowerCase()
    return GEMINI_NATIVE_VOICES.find(v => v.id.toLowerCase() === target) ?? null
  }
  ```
  > `VoiceOption.labels` is typed `Record<string, string>`, so `labels.gender`/`labels.description` are plain strings — the literal `'male'|'female'` union is fine as an assignment but reads back as `string` (the test uses `toContain`, which is satisfied).

- [ ] Run — expect PASS:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini-native-voices.test.ts
  ```
  Expected: `Test Files  1 passed`, `Tests  4 passed`.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add lib/voice/gemini-native-voices.ts lib/voice/gemini-native-voices.test.ts && git commit -m "$(cat <<'EOF'
  Add Gemini native-voice catalogue

  Static prebuilt-voice list (Puck, Charon, Kore, …) mirroring
  vapi-native-voices.ts, served as VoiceOption[].

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: `agentToolsToRealtimeDefs` — agent tools → realtime defs

**Files:**
- Create: `lib/voice/gemini/tool-defs.ts`
- Test: `lib/voice/gemini/tool-defs.test.ts`

- [ ] Write the failing test. Create `lib/voice/gemini/tool-defs.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { agentToolsToRealtimeDefs } from './tool-defs'

  describe('agentToolsToRealtimeDefs', () => {
    it('filters AGENT_TOOLS to the enabled names, preserving order of the catalogue', () => {
      const defs = agentToolsToRealtimeDefs(['send_reply', 'get_contact_details'])
      const names = defs.map(d => d.name).sort()
      expect(names).toEqual(['get_contact_details', 'send_reply'])
    })

    it('maps input_schema → RealtimeToolDef.parameters with string property types', () => {
      const [def] = agentToolsToRealtimeDefs(['get_contact_details'])
      expect(def.name).toBe('get_contact_details')
      expect(typeof def.description).toBe('string')
      expect(def.parameters.type).toBe('object')
      expect(def.parameters.properties.contactId.type).toBe('string')
      expect(def.parameters.required).toContain('contactId')
    })

    it('ignores unknown tool names', () => {
      expect(agentToolsToRealtimeDefs(['not_a_real_tool'])).toEqual([])
    })

    it('returns [] for an empty enabled list', () => {
      expect(agentToolsToRealtimeDefs([])).toEqual([])
    })

    it('coerces non-string schema types to strings and drops missing descriptions gracefully', () => {
      const defs = agentToolsToRealtimeDefs(['send_reply'])
      for (const d of defs) {
        for (const prop of Object.values(d.parameters.properties)) {
          expect(typeof prop.type).toBe('string')
        }
      }
    })
  })
  ```

- [ ] Run — expect FAIL (module missing):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini/tool-defs.test.ts
  ```
  Expected: import-resolution failure. Confirmed RED.

- [ ] Create `lib/voice/gemini/tool-defs.ts` (complete):
  ```ts
  /**
   * Map the agent's enabled CRM tools to RealtimeToolDef[] — the JSON-Schema
   * subset Gemini Live (and the Copilot provider) consume. Single source of
   * truth: the agent tool catalogue (lib/agent/tool-catalog.ts), the same
   * list the text/Vapi runtimes use. No parallel tool state.
   *
   * Pure + runtime-agnostic (no next/prisma) so Plan 2's Fly bridge can
   * import it too.
   */

  import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'
  import type { RealtimeToolDef } from '@/lib/copilot/types'

  export function agentToolsToRealtimeDefs(enabledTools: string[]): RealtimeToolDef[] {
    const enabled = new Set(enabledTools)
    const out: RealtimeToolDef[] = []
    for (const tool of AGENT_TOOLS) {
      if (!enabled.has(tool.name)) continue
      const schema = tool.input_schema
      const srcProps = (schema?.properties ?? {}) as Record<
        string,
        { type?: unknown; description?: unknown; enum?: unknown }
      >
      const properties: RealtimeToolDef['parameters']['properties'] = {}
      for (const [key, raw] of Object.entries(srcProps)) {
        const type = typeof raw?.type === 'string' ? raw.type : String(raw?.type ?? 'string')
        properties[key] = {
          type,
          ...(typeof raw?.description === 'string' ? { description: raw.description } : {}),
          ...(Array.isArray(raw?.enum) ? { enum: raw.enum.map(String) } : {}),
        }
      }
      const required = Array.isArray(schema?.required)
        ? (schema.required as unknown[]).filter((r): r is string => typeof r === 'string')
        : undefined
      out.push({
        name: tool.name,
        description: tool.description ?? '',
        parameters: {
          type: 'object',
          properties,
          ...(required && required.length ? { required } : {}),
        },
      })
    }
    return out
  }
  ```

- [ ] Run — expect PASS:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini/tool-defs.test.ts
  ```
  Expected: `Tests  5 passed`.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add lib/voice/gemini/tool-defs.ts lib/voice/gemini/tool-defs.test.ts && git commit -m "$(cat <<'EOF'
  Add agentToolsToRealtimeDefs — agent tool catalogue → RealtimeToolDef[]

  Pure mapping from AGENT_TOOLS input_schema to the JSON-Schema subset the
  Gemini Live runtime consumes. No parallel tool state.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: `buildGeminiVoiceSession` — the shared core

**Files:**
- Create: `lib/voice/gemini/voice-config.ts` (default-config helper)
- Create: `lib/voice/gemini/session.ts`
- Test: `lib/voice/gemini/session.test.ts`

- [ ] Create the tiny shared default-config helper `lib/voice/gemini/voice-config.ts` (pure, used by routes + the panel + tests so the default never drifts):
  ```ts
  /**
   * The runtime-agnostic shape of a Gemini voice config (the `config` arg
   * buildGeminiVoiceSession takes) + its defaults. Kept separate from the
   * Prisma model so the pure session builder never imports prisma.
   */

  export interface GeminiVoiceConfigShape {
    voiceName: string | null
    model: string
    firstMessage: string | null
    endCallMessage: string | null
    language: string | null
    maxDurationSecs: number
  }

  /** Env-overridable model; falls back to the consolidated audio-to-audio id. */
  export function geminiVoiceModel(): string {
    return process.env.GEMINI_VOICE_MODEL || 'gemini-3.1-flash-live'
  }

  export function defaultGeminiVoiceConfig(): GeminiVoiceConfigShape {
    return {
      voiceName: null,
      model: geminiVoiceModel(),
      firstMessage: null,
      endCallMessage: null,
      language: null,
      maxDurationSecs: 600,
    }
  }
  ```

- [ ] Write the failing test. Create `lib/voice/gemini/session.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildGeminiVoiceSession, agentToolsToRealtimeDefs } from './session'

  const agent = {
    name: 'Ava',
    systemPrompt: 'You are Ava, a friendly receptionist for Acme.',
    instructions: 'Always confirm the appointment date back to the caller.',
    enabledTools: ['get_contact_details', 'book_appointment'],
    locationId: 'loc_1',
    workspaceId: 'ws_1',
    agentId: 'agent_1',
  }
  const config = {
    voiceName: 'Kore',
    model: 'gemini-3.1-flash-live',
    firstMessage: 'Hi, thanks for calling Acme!',
    endCallMessage: 'Thanks for calling, goodbye!',
    language: 'en-US',
    maxDurationSecs: 720,
  }

  describe('buildGeminiVoiceSession', () => {
    it('re-exports agentToolsToRealtimeDefs', () => {
      expect(agentToolsToRealtimeDefs(['get_contact_details'])).toHaveLength(1)
    })

    it('composes systemInstruction = prompt + instructions + voice guardrail + first message', () => {
      const s = buildGeminiVoiceSession(agent, config)
      const sys = s.liveConfig.systemInstruction as string
      expect(sys).toContain('You are Ava, a friendly receptionist for Acme.')
      expect(sys).toContain('Always confirm the appointment date back to the caller.')
      expect(sys).toContain('voice agent') // guardrail block present
      expect(sys).toContain('your CRM') // brand-neutral guardrail
      expect(sys).toContain('Hi, thanks for calling Acme!') // first message guidance
      expect(sys).toContain('Thanks for calling, goodbye!') // end-call line
    })

    it('NEVER leaks HighLevel / GHL into the system instruction', () => {
      const sys = buildGeminiVoiceSession(agent, config).liveConfig.systemInstruction as string
      expect(sys).not.toMatch(/highlevel/i)
      expect(sys).not.toMatch(/\bGHL\b/)
    })

    it('omits instructions when null without a dangling separator', () => {
      const s = buildGeminiVoiceSession({ ...agent, instructions: null }, config)
      const sys = s.liveConfig.systemInstruction as string
      expect(sys).toContain('You are Ava')
      expect(sys).not.toContain('\n\nnull')
    })

    it('wires the enabled tools as functionDeclarations and echoes them on tools', () => {
      const s = buildGeminiVoiceSession(agent, config)
      expect(s.tools.map(t => t.name).sort()).toEqual(['book_appointment', 'get_contact_details'])
      const tools = s.liveConfig.tools as Array<{ functionDeclarations: Array<{ name: string }> }>
      const declNames = tools[0].functionDeclarations.map(d => d.name).sort()
      expect(declNames).toEqual(['book_appointment', 'get_contact_details'])
    })

    it('locks AUDIO modality + transcription + the selected voice', () => {
      const s = buildGeminiVoiceSession(agent, config)
      expect(s.liveConfig.responseModalities).toEqual(['AUDIO'])
      expect(s.liveConfig.inputAudioTranscription).toBeDefined()
      expect(s.liveConfig.outputAudioTranscription).toBeDefined()
      const speech = s.liveConfig.speechConfig as {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: string } }
      }
      expect(speech.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Kore')
      expect(s.voiceName).toBe('Kore')
      expect(s.vendorModelId).toBe('gemini-3.1-flash-live')
    })

    it('omits speechConfig when no voice is chosen', () => {
      const s = buildGeminiVoiceSession(agent, { ...config, voiceName: null })
      expect(s.liveConfig.speechConfig).toBeUndefined()
      expect(s.voiceName).toBeNull()
    })

    it('clamps maxSessionSecs to a sane floor and echoes it', () => {
      expect(buildGeminiVoiceSession(agent, { ...config, maxDurationSecs: 720 }).maxSessionSecs).toBe(720)
      // sub-floor values snap up to 60s minimum
      expect(buildGeminiVoiceSession(agent, { ...config, maxDurationSecs: 5 }).maxSessionSecs).toBe(60)
    })

    it('appends a ragContext block when provided', () => {
      const s = buildGeminiVoiceSession(agent, config, { ragContext: 'Acme is open 9-5 Mon-Fri.' })
      expect(s.liveConfig.systemInstruction as string).toContain('Acme is open 9-5 Mon-Fri.')
    })
  })
  ```

- [ ] Run — expect FAIL (module missing):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini/session.test.ts
  ```
  Expected: import-resolution failure. Confirmed RED.

- [ ] Create `lib/voice/gemini/session.ts` (complete). This is the locked-contract module — **no next/prisma imports**:
  ```ts
  /**
   * buildGeminiVoiceSession — the single source of truth for a Gemini
   * native-voice session, consumed by BOTH runtimes:
   *   - web (this plan): the token route mints from it, the browser
   *     GeminiLiveProvider connects with liveConfig as vendorConfig.
   *   - phone (Plan 2): the Fly.io bridge imports this exact function.
   *
   * RUNTIME-AGNOSTIC: no next, no prisma, no @google/genai imports. Pure
   * data in → pure GeminiVoiceSession out. The server mint (mint.ts) is
   * the only piece that touches @google/genai.
   *
   * Mirrors the liveConfig shape the Copilot session-service already
   * ships (responseModalities AUDIO, in/out transcription, context-window
   * compression, session resumption, optional prebuilt voice), minus the
   * screen-vision mediaResolution (voice has no video).
   */

  import type { RealtimeToolDef } from '@/lib/copilot/types'
  import { agentToolsToRealtimeDefs } from './tool-defs'

  export { agentToolsToRealtimeDefs }

  export interface GeminiVoiceSession {
    liveConfig: Record<string, unknown>
    tools: RealtimeToolDef[]
    vendorModelId: string
    voiceName: string | null
    maxSessionSecs: number
  }

  /**
   * Brand-neutral VOICE guardrail. Speech-specific (concise spoken
   * sentences, no markdown), and the hard no-HighLevel/GHL rule — say
   * "your CRM". endCallMessage/firstMessage guidance folded in when set.
   */
  function buildVoiceGuardrail(config: {
    firstMessage: string | null
    endCallMessage: string | null
    language: string | null
  }): string {
    const lines: string[] = [
      '## Voice agent guardrails',
      'You are a voice agent: the caller HEARS you, they do not read you.',
      'Speak naturally in short, conversational spoken sentences. Never use',
      'markdown, bullet points, code, emoji, or formatting — it cannot be heard.',
      'Spell out anything that must be precise (phone numbers, emails) clearly.',
      'Never say the words "HighLevel" or "GHL". If you need to refer to the',
      'underlying system, say "your CRM".',
    ]
    if (config.language) {
      lines.push(`Speak in ${config.language} unless the caller switches languages.`)
    }
    if (config.firstMessage) {
      lines.push(`Open the call with words to the effect of: "${config.firstMessage}"`)
    }
    if (config.endCallMessage) {
      lines.push(
        `When the conversation is clearly finished, or you must end the call,`,
        `close with words to the effect of: "${config.endCallMessage}"`,
      )
    }
    return lines.join('\n')
  }

  function buildSystemInstruction(
    agent: { systemPrompt: string; instructions: string | null },
    config: { firstMessage: string | null; endCallMessage: string | null; language: string | null },
    opts: { ragContext?: string } = {},
  ): string {
    const parts: string[] = [agent.systemPrompt.trim()]
    if (agent.instructions && agent.instructions.trim()) {
      parts.push(agent.instructions.trim())
    }
    if (opts.ragContext && opts.ragContext.trim()) {
      parts.push(`## Knowledge\n${opts.ragContext.trim()}`)
    }
    parts.push(buildVoiceGuardrail(config))
    return parts.join('\n\n')
  }

  export function buildGeminiVoiceSession(
    agent: {
      name: string
      systemPrompt: string
      instructions: string | null
      enabledTools: string[]
      locationId: string
      workspaceId: string | null
      agentId: string
    },
    config: {
      voiceName: string | null
      model: string
      firstMessage: string | null
      endCallMessage: string | null
      language: string | null
      maxDurationSecs: number
    },
    opts: { ragContext?: string; locale?: string } = {},
  ): GeminiVoiceSession {
    const tools = agentToolsToRealtimeDefs(agent.enabledTools)
    const systemInstruction = buildSystemInstruction(agent, config, opts)
    const voiceName = config.voiceName || null
    const vendorModelId = config.model
    const maxSessionSecs = Math.max(60, Math.round(config.maxDurationSecs) || 60)

    const liveConfig: Record<string, unknown> = {
      responseModalities: ['AUDIO'],
      systemInstruction,
      tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: {},
      ...(voiceName
        ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }
        : {}),
    }

    return { liveConfig, tools, vendorModelId, voiceName, maxSessionSecs }
  }

  /**
   * Map RealtimeToolDef[] → Gemini functionDeclarations using plain string
   * enum/type tokens (UPPERCASE type names). We DON'T import @google/genai's
   * Type/Behavior enums here to keep this module runtime-agnostic — the
   * string values are wire-identical to the SDK enums. The Copilot
   * session-service uses the SDK enums; this is the same JSON.
   */
  function toGeminiFunctionDeclarations(defs: RealtimeToolDef[]) {
    return defs.map(d => ({
      name: d.name,
      description: d.description,
      behavior: 'NON_BLOCKING',
      ...(Object.keys(d.parameters.properties).length > 0
        ? {
            parameters: {
              type: 'OBJECT',
              properties: Object.fromEntries(
                Object.entries(d.parameters.properties).map(([k, v]) => [
                  k,
                  {
                    type: v.type.toUpperCase(),
                    ...(v.description ? { description: v.description } : {}),
                    ...(v.enum ? { enum: v.enum } : {}),
                  },
                ]),
              ),
              ...(d.parameters.required?.length ? { required: d.parameters.required } : {}),
            },
          }
        : {}),
    }))
  }
  ```
  > **Design note:** the Copilot `mintEphemeralToken` uses `Behavior.NON_BLOCKING` / `Type.OBJECT` SDK enums. Their runtime string values are `'NON_BLOCKING'` / `'OBJECT'`, so emitting the strings keeps this module free of `@google/genai` (required by the locked contract) while producing byte-identical JSON. The mint (Task 5) passes `liveConfig` straight into `liveConnectConstraints.config`, exactly as Copilot does.

- [ ] Run — expect PASS:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini/session.test.ts
  ```
  Expected: `Tests  9 passed`.

- [ ] Typecheck the whole module set:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add lib/voice/gemini/voice-config.ts lib/voice/gemini/session.ts lib/voice/gemini/session.test.ts && git commit -m "$(cat <<'EOF'
  Add buildGeminiVoiceSession — runtime-agnostic Gemini voice core

  Pure session builder (no next/prisma): composes the agent prompt +
  brand-neutral voice guardrails, wires enabled CRM tools, locks AUDIO
  modality + voice + transcription into liveConfig. Single source of truth
  for both the web token route and the Plan-2 Fly phone bridge.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: `mintGeminiVoiceToken` — server ephemeral token

**Files:**
- Create: `lib/voice/gemini/mint.ts`

(Server module importing `@google/genai` — not unit-tested per project convention; verified live via the token route in Task 13.)

- [ ] Create `lib/voice/gemini/mint.ts` (complete):
  ```ts
  /**
   * Server-only mint: GeminiVoiceSession → a Google ephemeral token with
   * the session config LOCKED inside via liveConnectConstraints, so the
   * browser (or the Plan-2 bridge) holds the connection but cannot tamper
   * with the model id, prompt, or tools.
   *
   * Reuses the exact pattern from lib/copilot/session-service.ts
   * (mintEphemeralToken): uses:10 (the WS drops ~10min in and the client
   * reconnects with its sessionResumption handle), expireTime padded +5min
   * past the session ceiling, v1alpha http.
   */

  import { GoogleGenAI } from '@google/genai'
  import type { GeminiVoiceSession } from './session'

  export class GeminiVoiceNotConfiguredError extends Error {}
  export class GeminiVoiceTokenMintError extends Error {}

  export async function mintGeminiVoiceToken(
    s: GeminiVoiceSession,
  ): Promise<{ token: string; vendorModelId: string; maxSessionSecs: number }> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new GeminiVoiceNotConfiguredError('missing GEMINI_API_KEY')

    const now = Date.now()
    try {
      const ai = new GoogleGenAI({ apiKey })
      const token = await ai.authTokens.create({
        config: {
          uses: 10,
          expireTime: new Date(now + (s.maxSessionSecs + 300) * 1000).toISOString(),
          newSessionExpireTime: new Date(now + s.maxSessionSecs * 1000).toISOString(),
          liveConnectConstraints: { model: s.vendorModelId, config: s.liveConfig },
          httpOptions: { apiVersion: 'v1alpha' },
        },
      })
      if (!token.name) throw new Error('token response missing name')
      return { token: token.name, vendorModelId: s.vendorModelId, maxSessionSecs: s.maxSessionSecs }
    } catch (err) {
      if (err instanceof GeminiVoiceNotConfiguredError) throw err
      console.error('[GeminiVoice] ephemeral token mint failed:', err)
      throw new GeminiVoiceTokenMintError(err instanceof Error ? err.message : String(err))
    }
  }
  ```

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add lib/voice/gemini/mint.ts && git commit -m "$(cat <<'EOF'
  Add mintGeminiVoiceToken — server ephemeral-token mint

  GeminiVoiceSession → Google ephemeral token with the session config
  locked via liveConnectConstraints. Reuses the Copilot mint pattern
  (uses:10, padded expiry, v1alpha).

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Gemini-voice config API (GET / PUT)

**Files:**
- Create: `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/route.ts`

(Route handler + Prisma — not unit-tested. Verified live in Task 13. Consult `node_modules/next/dist/docs/` for the App Router handler signature before writing.)

- [ ] Create `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/route.ts` (complete):
  ```ts
  import { NextRequest, NextResponse } from 'next/server'
  import { db } from '@/lib/db'
  import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
  import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'

  type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

  /**
   * GET — load the agent's GeminiVoiceConfig, creating a default row if
   * none exists (so the UI always has something to bind to). Also returns
   * the agent's current voiceRuntime + whether GEMINI_API_KEY is set.
   */
  export async function GET(_req: NextRequest, { params }: Params) {
    const { workspaceId, agentId } = await params
    const access = await requireWorkspaceAccess(workspaceId)
    if (access instanceof NextResponse) return access

    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { id: true, name: true, voiceRuntime: true },
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    let config = await db.geminiVoiceConfig.findUnique({ where: { agentId } })
    if (!config) {
      config = await db.geminiVoiceConfig.create({
        data: { agentId, model: geminiVoiceModel() },
      })
    }

    const geminiReady = !!process.env.GEMINI_API_KEY
    return NextResponse.json({
      config,
      voiceRuntime: agent.voiceRuntime ?? 'vapi',
      agentName: agent.name,
      geminiReady,
    })
  }

  /**
   * PUT — upsert the GeminiVoiceConfig and set Agent.voiceRuntime to
   * 'gemini' when isActive, else 'vapi'. The body is the editable subset
   * of the config; server controls agentId + timestamps.
   */
  export async function PUT(req: NextRequest, { params }: Params) {
    const { workspaceId, agentId } = await params
    const access = await requireWorkspaceAccess(workspaceId)
    if (access instanceof NextResponse) return access

    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { id: true },
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // Whitelist editable fields — never trust client-supplied agentId/ids.
    const data = {
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
      voiceName: typeof body.voiceName === 'string' || body.voiceName === null ? (body.voiceName as string | null) : undefined,
      model: typeof body.model === 'string' && body.model ? body.model : undefined,
      firstMessage: typeof body.firstMessage === 'string' || body.firstMessage === null ? (body.firstMessage as string | null) : undefined,
      endCallMessage: typeof body.endCallMessage === 'string' || body.endCallMessage === null ? (body.endCallMessage as string | null) : undefined,
      maxDurationSecs: typeof body.maxDurationSecs === 'number' && body.maxDurationSecs > 0 ? Math.round(body.maxDurationSecs) : undefined,
      recordCalls: typeof body.recordCalls === 'boolean' ? body.recordCalls : undefined,
      language: typeof body.language === 'string' || body.language === null ? (body.language as string | null) : undefined,
    }
    // Drop undefined keys so Prisma update doesn't null-out unspecified columns.
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))

    const config = await db.geminiVoiceConfig.upsert({
      where: { agentId },
      create: { agentId, model: geminiVoiceModel(), ...clean },
      update: clean,
    })

    // Flip the runtime discriminator off this save. Activating Gemini sets
    // the agent's runtime to 'gemini'; deactivating returns it to 'vapi'.
    await db.agent.update({
      where: { id: agentId },
      data: { voiceRuntime: config.isActive ? 'gemini' : 'vapi' },
    })

    return NextResponse.json({ config, voiceRuntime: config.isActive ? 'gemini' : 'vapi' })
  }
  ```

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add "app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/route.ts" && git commit -m "$(cat <<'EOF'
  Add gemini-voice config API (GET default-on-read, PUT upsert)

  PUT flips Agent.voiceRuntime ('gemini' when active, else 'vapi').
  Whitelisted fields; gated by requireWorkspaceAccess.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Web token route (dashboard preview)

**Files:**
- Create: `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/token/route.ts`

(Route + Prisma + mint — not unit-tested. Verified live in Task 13.)

- [ ] Create `app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/token/route.ts` (complete):
  ```ts
  import { NextRequest, NextResponse } from 'next/server'
  import { db } from '@/lib/db'
  import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
  import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
  import {
    mintGeminiVoiceToken,
    GeminiVoiceNotConfiguredError,
    GeminiVoiceTokenMintError,
  } from '@/lib/voice/gemini/mint'
  import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'

  type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

  /**
   * POST — mint a web ephemeral token for the dashboard "Test voice" call.
   * Returns a RealtimeProviderConfig-shaped body the browser passes to
   * GeminiLiveProvider.connect(). The session config is locked inside the
   * token; vendorConfig echoes liveConfig because the SDK requires it at
   * connect and it must match the constraint byte-for-byte.
   */
  export async function POST(_req: NextRequest, { params }: Params) {
    const { workspaceId, agentId } = await params
    const access = await requireWorkspaceAccess(workspaceId)
    if (access instanceof NextResponse) return access

    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: {
        id: true,
        name: true,
        systemPrompt: true,
        instructions: true,
        enabledTools: true,
        locationId: true,
        workspaceId: true,
      },
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    const config = await db.geminiVoiceConfig.findUnique({ where: { agentId } })

    const session = buildGeminiVoiceSession(
      {
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        instructions: agent.instructions,
        enabledTools: agent.enabledTools,
        locationId: agent.locationId,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
      },
      {
        voiceName: config?.voiceName ?? null,
        model: config?.model || geminiVoiceModel(),
        firstMessage: config?.firstMessage ?? null,
        endCallMessage: config?.endCallMessage ?? null,
        language: config?.language ?? null,
        maxDurationSecs: config?.maxDurationSecs ?? 600,
      },
    )

    try {
      const minted = await mintGeminiVoiceToken(session)
      return NextResponse.json({
        connection: {
          token: minted.token,
          vendorModelId: minted.vendorModelId,
          provider: 'gemini-live' as const,
          maxSessionSecs: minted.maxSessionSecs,
          frameFpsCap: 0,
        },
        tools: session.tools,
        vendorConfig: session.liveConfig,
      })
    } catch (err) {
      if (err instanceof GeminiVoiceNotConfiguredError) {
        return NextResponse.json(
          { error: 'Gemini voice is not configured (missing GEMINI_API_KEY).', code: 'GEMINI_NOT_CONFIGURED' },
          { status: 503 },
        )
      }
      if (err instanceof GeminiVoiceTokenMintError) {
        return NextResponse.json(
          { error: 'Could not start a Gemini voice session right now.', code: 'GEMINI_TOKEN_MINT_FAILED' },
          { status: 502 },
        )
      }
      throw err
    }
  }
  ```

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add "app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice/token/route.ts" && git commit -m "$(cat <<'EOF'
  Add dashboard Gemini voice token route

  Mints a web ephemeral token from buildGeminiVoiceSession; returns a
  RealtimeProviderConfig the browser feeds GeminiLiveProvider.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Tool-exec route

**Files:**
- Create: `app/api/voice/gemini/tool/route.ts`

(Route + executor + Prisma — not unit-tested. Verified live in Task 13.)

- [ ] Create `app/api/voice/gemini/tool/route.ts` (complete). The browser passes `agentId` only; the server resolves `locationId` — **never trust a client-supplied locationId**. Two auth paths: dashboard preview (NextAuth/workspace) and public widget (widget public key):
  ```ts
  import { NextRequest, NextResponse } from 'next/server'
  import { db } from '@/lib/db'
  import { auth } from '@/lib/auth'
  import { executeTool } from '@/lib/agent/execute-tool'
  import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

  /**
   * POST { agentId, name, args, widgetId? }
   *
   * Runs ONE agent tool against the real CRM and returns { result }.
   * The browser/bridge never touches CRM credentials: the server resolves
   * locationId from the agent row (client-supplied locationId is ignored).
   *
   * Auth:
   *  - widgetId present → public widget call: validate the widget public
   *    key + origin, and require the agent to belong to the widget's
   *    workspace (so a visitor can't drive an arbitrary agent).
   *  - else → dashboard preview: require an authenticated user who is a
   *    member of the agent's workspace.
   */
  export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
  }

  export async function POST(req: NextRequest) {
    const cors = widgetCorsHeaders(req.headers.get('origin'))
    const body = (await req.json().catch(() => ({}))) as {
      agentId?: string
      name?: string
      args?: Record<string, unknown>
      widgetId?: string
    }
    const agentId = typeof body.agentId === 'string' ? body.agentId : ''
    const name = typeof body.name === 'string' ? body.name : ''
    const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>
    if (!agentId || !name) {
      return NextResponse.json({ error: 'agentId and name required' }, { status: 400, headers: cors })
    }

    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { id: true, locationId: true, workspaceId: true, enabledTools: true },
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: cors })

    // Only allow tools the agent actually has enabled (defense in depth —
    // the locked token already restricts declarations, but the exec path
    // is a separate trust boundary).
    if (!agent.enabledTools.includes(name)) {
      return NextResponse.json({ error: 'Tool not enabled for this agent' }, { status: 403, headers: cors })
    }

    // ── Auth branch ──
    if (body.widgetId) {
      const v = await validateWidgetRequest(req, body.widgetId)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors })
      if (v.widget.workspaceId !== agent.workspaceId) {
        return NextResponse.json({ error: 'Agent not on this widget workspace' }, { status: 403, headers: cors })
      }
    } else {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
      }
      if (!agent.workspaceId) {
        return NextResponse.json({ error: 'Agent has no workspace' }, { status: 403, headers: cors })
      }
      const member = await db.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: session.user.id, workspaceId: agent.workspaceId } },
        select: { role: true },
      })
      if (!member) return NextResponse.json({ error: 'Access denied' }, { status: 403, headers: cors })
    }

    try {
      const result = await executeTool(name, args, agent.locationId, false, agent.id, 'voice')
      return NextResponse.json({ result }, { headers: cors })
    } catch (err) {
      console.error('[GeminiVoice tool] exec failed:', err)
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Tool execution failed' },
        { status: 500, headers: cors },
      )
    }
  }
  ```
  > `executeTool` returns `Promise<string>`. The Gemini provider's `onToolCall` must resolve a `Record<string, unknown>`, so the client wraps `{ result }` (the route's JSON) — see the panel + widget wiring in Tasks 11–12, which call this route and return the parsed body to the provider.

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add "app/api/voice/gemini/tool/route.ts" && git commit -m "$(cat <<'EOF'
  Add Gemini voice tool-exec route

  Resolves locationId server-side from agentId, runs executeTool against
  the CRM, returns { result }. Dual auth: workspace member (dashboard) or
  widget public key (public). Client-supplied locationId is never trusted.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: `/api/voices` gemini branch

**Files:**
- Create: `lib/voice/gemini/voices-wire.ts` (pure helper the route + test share)
- Test: `app/api/voices/route.gemini-filter.test.ts` → relocate to `lib/voice/gemini/voices-wire.test.ts` (tests must live under `lib/**`)
- Modify: `app/api/voices/route.ts`

> Vitest scope is `lib/**/*.test.ts` only — put the test under `lib/`, not `app/`. The plan's earlier File Structure entry `app/api/voices/route.gemini-filter.test.ts` is superseded by `lib/voice/gemini/voices-wire.test.ts` for this reason.

- [ ] Write the failing test. Create `lib/voice/gemini/voices-wire.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { filterGeminiVoices, toVoiceWire } from './voices-wire'

  describe('voices-wire (gemini)', () => {
    it('returns the full catalogue when no search', () => {
      expect(filterGeminiVoices().length).toBe(8)
    })

    it('filters by name (case-insensitive)', () => {
      const r = filterGeminiVoices('kore')
      expect(r.map(v => v.id)).toEqual(['Kore'])
    })

    it('filters by description substring', () => {
      const r = filterGeminiVoices('authoritative')
      expect(r.map(v => v.id)).toContain('Charon')
    })

    it('maps to the shared wire shape', () => {
      const wire = toVoiceWire(filterGeminiVoices('puck')[0])
      expect(wire).toMatchObject({
        voice_id: 'Puck',
        name: 'Puck',
        preview_url: null,
        language: 'en',
        category: 'premade',
      })
      expect(wire.labels).toBeTypeOf('object')
    })
  })
  ```

- [ ] Run — expect FAIL (module missing):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini/voices-wire.test.ts
  ```
  Expected: import-resolution failure. Confirmed RED.

- [ ] Create `lib/voice/gemini/voices-wire.ts` (complete):
  ```ts
  /**
   * Pure helpers behind GET /api/voices?provider=gemini. Kept out of the
   * route so the filter + wire mapping are unit-testable under lib/**.
   */

  import { GEMINI_NATIVE_VOICES } from '@/lib/voice/gemini-native-voices'
  import type { VoiceOption } from '@/lib/voice/types'

  export function filterGeminiVoices(search?: string): VoiceOption[] {
    if (!search) return GEMINI_NATIVE_VOICES
    const q = search.toLowerCase()
    return GEMINI_NATIVE_VOICES.filter(
      v =>
        v.name.toLowerCase().includes(q) ||
        (v.labels?.description ?? '').toLowerCase().includes(q),
    )
  }

  export function toVoiceWire(v: VoiceOption) {
    return {
      voice_id: v.id,
      name: v.name,
      preview_url: v.previewUrl ?? null,
      labels: v.labels ?? {},
      language: v.language ?? null,
      category: 'premade' as const,
    }
  }
  ```

- [ ] Run — expect PASS:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx vitest run lib/voice/gemini/voices-wire.test.ts
  ```
  Expected: `Tests  4 passed`.

- [ ] Modify `app/api/voices/route.ts` to add the gemini branch. Add the import after the existing imports (line 3):
  ```ts
  import { filterGeminiVoices, toVoiceWire } from '@/lib/voice/gemini/voices-wire'
  ```
  Then insert the gemini branch inside the `try` block, immediately BEFORE the existing `if (provider === 'elevenlabs' || provider === '11labs')` block:
  ```ts
    if (provider === 'gemini') {
      return NextResponse.json({
        provider: 'gemini',
        voices: filterGeminiVoices(search).map(toVoiceWire),
      })
    }

  ```

- [ ] Typecheck + re-run the voices test:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit && npx vitest run lib/voice/gemini/voices-wire.test.ts
  ```
  Expected: no type errors; `Tests  4 passed`.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add lib/voice/gemini/voices-wire.ts lib/voice/gemini/voices-wire.test.ts app/api/voices/route.ts && git commit -m "$(cat <<'EOF'
  Add provider=gemini branch to /api/voices

  Returns the Gemini prebuilt catalogue in the existing voice wire shape;
  filter + mapping factored into a unit-tested lib helper.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Transcript persistence route

**Files:**
- Create: `app/api/voice/gemini/transcript/route.ts`

(Route + Prisma — not unit-tested. Verified live in Task 13.)

The browser accumulates transcript turns client-side (from `onTranscript`) and POSTs them on call end. Dashboard test calls log to `CallLog`; widget calls update the existing `WidgetVoiceCall` row.

- [ ] Create `app/api/voice/gemini/transcript/route.ts` (complete):
  ```ts
  import { NextRequest, NextResponse } from 'next/server'
  import { db } from '@/lib/db'
  import { auth } from '@/lib/auth'
  import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

  interface TurnIn {
    role?: string
    text?: string
  }

  /**
   * POST persist a finished Gemini voice call's transcript + duration.
   *
   * Two surfaces share one route:
   *  - dashboard test call: { agentId, durationSecs, turns } → CallLog row
   *    (direction 'inbound', triggerSource 'gemini-test', status 'completed').
   *  - widget call: { widgetId, callId, durationSecs, turns } → updates the
   *    existing WidgetVoiceCall row (created by the widget token route).
   *
   * Turns are rendered to a plain "Role: text" transcript string — the same
   * shape CallLog.transcript / WidgetVoiceCall.transcript already store, so
   * inbox + portal render Gemini voice calls with no special-casing.
   */
  export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
  }

  function renderTranscript(turns: TurnIn[]): string {
    return turns
      .filter(t => typeof t.text === 'string' && t.text!.trim())
      .map(t => {
        const role = t.role === 'agent' ? 'Agent' : t.role === 'user' ? 'Caller' : (t.role || 'system')
        return `${role}: ${t.text!.trim()}`
      })
      .join('\n')
      .slice(0, 100000)
  }

  export async function POST(req: NextRequest) {
    const cors = widgetCorsHeaders(req.headers.get('origin'))
    const body = (await req.json().catch(() => ({}))) as {
      agentId?: string
      widgetId?: string
      callId?: string
      durationSecs?: number
      turns?: TurnIn[]
    }
    const turns = Array.isArray(body.turns) ? body.turns.slice(0, 500) : []
    const durationSecs =
      typeof body.durationSecs === 'number' && body.durationSecs >= 0
        ? Math.round(body.durationSecs)
        : null
    const transcript = renderTranscript(turns)

    // ── Widget surface ──
    if (body.widgetId && body.callId) {
      const v = await validateWidgetRequest(req, body.widgetId)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors })

      // Ensure the call row belongs to a conversation on THIS widget.
      const call = await db.widgetVoiceCall.findFirst({
        where: { id: body.callId, conversation: { widgetId: body.widgetId } },
        select: { id: true },
      })
      if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404, headers: cors })

      await db.widgetVoiceCall.update({
        where: { id: call.id },
        data: { status: 'completed', endedAt: new Date(), durationSecs, transcript },
      })
      return NextResponse.json({ ok: true }, { headers: cors })
    }

    // ── Dashboard surface ──
    const agentId = typeof body.agentId === 'string' ? body.agentId : ''
    if (!agentId) return NextResponse.json({ error: 'agentId or widgetId+callId required' }, { status: 400, headers: cors })

    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { id: true, locationId: true, workspaceId: true },
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: cors })

    const session = await auth()
    if (!session?.user?.id || !agent.workspaceId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
    }
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId: agent.workspaceId } },
      select: { role: true },
    })
    if (!member) return NextResponse.json({ error: 'Access denied' }, { status: 403, headers: cors })

    const log = await db.callLog.create({
      data: {
        locationId: agent.locationId,
        agentId: agent.id,
        direction: 'inbound',
        status: 'completed',
        durationSecs,
        transcript,
        endedReason: 'gemini_test_ended',
        triggerSource: 'gemini-test',
      },
    })
    return NextResponse.json({ ok: true, callLogId: log.id }, { headers: cors })
  }
  ```

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add "app/api/voice/gemini/transcript/route.ts" && git commit -m "$(cat <<'EOF'
  Add Gemini voice transcript persistence route

  Dashboard test calls → CallLog; widget calls → WidgetVoiceCall. Renders
  turns to the existing plain-text transcript shape so inbox/portal need no
  special-casing.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Dashboard voice page — runtime picker + Gemini panel + Test voice

**Files:**
- Create: `components/voice/GeminiVoicePanel.tsx`
- Modify: `app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx`

This task keeps the voice page's CURRENT save mechanism (legacy inline save). It adds a top-level runtime picker ABOVE the existing engine tabs, and renders the Gemini panel (its own self-saving component, hitting the gemini-voice API) when Gemini is selected. The Test-voice call reuses `MicCapture`/`PcmPlayer` from `lib/copilot/audio-client.ts` and `GeminiLiveProvider` AS-IS.

- [ ] Create `components/voice/GeminiVoicePanel.tsx` (complete). It owns its own load/save against the gemini-voice API (independent of the page's Vapi form), the voice catalogue browse, and the in-browser Test-voice call:
  ```tsx
  'use client'

  import { useCallback, useEffect, useRef, useState } from 'react'
  import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
  import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
  import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'

  interface GeminiConfig {
    isActive: boolean
    voiceName: string | null
    model: string
    firstMessage: string | null
    endCallMessage: string | null
    maxDurationSecs: number
    recordCalls: boolean
    language: string | null
  }

  interface VoiceWire {
    voice_id: string
    name: string
    labels: Record<string, string>
    language: string | null
  }

  type CallState = 'idle' | 'connecting' | 'live' | 'error'
  type Turn = { role: 'user' | 'agent'; text: string }

  export default function GeminiVoicePanel({
    workspaceId,
    agentId,
  }: {
    workspaceId: string
    agentId: string
  }) {
    const [config, setConfig] = useState<GeminiConfig | null>(null)
    const [geminiReady, setGeminiReady] = useState(true)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [voices, setVoices] = useState<VoiceWire[]>([])

    const [callState, setCallState] = useState<CallState>('idle')
    const [callError, setCallError] = useState<string | null>(null)
    const turnsRef = useRef<Turn[]>([])
    const providerRef = useRef<GeminiLiveProvider | null>(null)
    const micRef = useRef<MicCapture | null>(null)
    const playerRef = useRef<PcmPlayer | null>(null)
    const startedAtRef = useRef<number>(0)

    // Load config + voice catalogue.
    useEffect(() => {
      let alive = true
      ;(async () => {
        const [cfgRes, voicesRes] = await Promise.all([
          fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice`),
          fetch(`/api/voices?provider=gemini`),
        ])
        const cfg = await cfgRes.json()
        const vs = await voicesRes.json()
        if (!alive) return
        setConfig(cfg.config)
        setGeminiReady(cfg.geminiReady)
        setVoices(vs.voices ?? [])
      })().catch(() => {})
      return () => {
        alive = false
      }
    }, [workspaceId, agentId])

    const patch = (p: Partial<GeminiConfig>) => setConfig(c => (c ? { ...c, ...p } : c))

    const save = useCallback(async () => {
      if (!config) return
      setSaving(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(config),
        })
        const json = await res.json()
        if (json.config) setConfig(json.config)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } finally {
        setSaving(false)
      }
    }, [config, workspaceId, agentId])

    const endCall = useCallback(async () => {
      const durationSecs = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0
      try {
        await providerRef.current?.close()
      } catch {}
      micRef.current?.stop()
      playerRef.current?.stop()
      providerRef.current = null
      micRef.current = null
      playerRef.current = null
      setCallState('idle')
      // Persist transcript (best-effort).
      if (turnsRef.current.length) {
        void fetch(`/api/voice/gemini/transcript`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ agentId, durationSecs, turns: turnsRef.current }),
        }).catch(() => {})
      }
      turnsRef.current = []
    }, [agentId])

    const startCall = useCallback(async () => {
      setCallError(null)
      setCallState('connecting')
      turnsRef.current = []
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice/token`,
          { method: 'POST' },
        )
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error || 'Could not start voice session')
        }
        const { connection, tools, vendorConfig } = await res.json()

        const provider = new GeminiLiveProvider()
        const player = new PcmPlayer()
        await player.start()
        const mic = new MicCapture(chunk => provider.sendAudioChunk(chunk))

        provider.onAudioOutput = pcm => player.enqueue(pcm)
        provider.onInterrupted = () => player.flush()
        provider.onTranscript = turn => {
          if (turn.final) turnsRef.current.push({ role: turn.role, text: turn.text })
        }
        provider.onToolCall = async call => {
          const r = await fetch(`/api/voice/gemini/tool`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agentId, name: call.name, args: call.args }),
          })
          return await r.json().catch(() => ({ error: 'tool failed' }))
        }
        provider.onError = msg => {
          setCallError(msg)
          setCallState('error')
        }
        provider.onEnded = () => {
          void endCall()
        }

        await provider.connect({ connection, tools, vendorConfig })
        await mic.start()
        providerRef.current = provider
        micRef.current = mic
        playerRef.current = player
        startedAtRef.current = Date.now()
        setCallState('live')
      } catch (err) {
        setCallError(err instanceof Error ? err.message : 'Voice session failed')
        setCallState('error')
        micRef.current?.stop()
        playerRef.current?.stop()
      }
    }, [workspaceId, agentId, endCall])

    useEffect(() => () => void endCall(), [endCall])

    if (!config) {
      return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading Gemini voice…</p>
    }

    return (
      <div className="space-y-5">
        {!geminiReady && (
          <div className="rounded-lg border px-4 py-3" style={{ borderColor: 'var(--accent-red)', background: 'var(--surface-secondary)' }}>
            <p className="text-xs" style={{ color: 'var(--accent-red)' }}>
              Gemini voice isn&apos;t configured on the server yet (missing API key). You can edit settings, but test calls won&apos;t connect.
            </p>
          </div>
        )}

        {/* Enable */}
        <div className="flex items-center justify-between rounded-xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Enable Gemini voice</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Native speech-to-speech — the most human-sounding option.</p>
          </div>
          <button type="button" onClick={() => patch({ isActive: !config.isActive })}
            className="relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors"
            style={{ background: config.isActive ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}>
            <span className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${config.isActive ? 'translate-x-5' : 'translate-x-0'}`} style={{ background: '#fff' }} />
          </button>
        </div>

        {/* Voice picker */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {voices.map(v => {
              const active = config.voiceName === v.voice_id
              return (
                <button key={v.voice_id} type="button" onClick={() => patch({ voiceName: v.voice_id })}
                  className="text-left rounded-lg border px-3 py-2 transition-colors"
                  style={active
                    ? { borderColor: '#fa4d2e', background: 'var(--surface-secondary)' }
                    : { borderColor: 'var(--border)', background: 'transparent' }}>
                  <span className="text-xs font-semibold block" style={{ color: 'var(--text-primary)' }}>{v.name}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{v.labels.description ?? ''}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* First / end message */}
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>First message</p>
            <MergeFieldTextarea value={config.firstMessage ?? ''} onChange={(val: string) => patch({ firstMessage: val })}
              placeholder="Hi, thanks for calling — how can I help?" rows={2} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>End-call message</p>
            <MergeFieldTextarea value={config.endCallMessage ?? ''} onChange={(val: string) => patch({ endCallMessage: val })}
              placeholder="Thanks for calling — goodbye!" rows={2} />
          </div>
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Language (optional, BCP-47)</p>
            <input value={config.language ?? ''} onChange={e => patch({ language: e.target.value || null })}
              placeholder="en-US" className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-primary)' }} />
          </div>
        </div>

        {/* Save + Test voice */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            style={{ background: '#fa4d2e', color: '#ffffff' }}>
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Gemini voice'}
          </button>

          {callState === 'idle' || callState === 'error' ? (
            <button type="button" onClick={startCall} disabled={!geminiReady}
              className="text-xs font-semibold px-4 py-2 rounded-lg border transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--surface-secondary)' }}>
              🎙 Test voice
            </button>
          ) : (
            <button type="button" onClick={() => void endCall()}
              className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
              style={{ background: 'var(--accent-red)', color: '#ffffff' }}>
              {callState === 'connecting' ? 'Connecting… (tap to cancel)' : 'End test call'}
            </button>
          )}
          {callState === 'live' && <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>● live</span>}
        </div>
        {callError && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{callError}</p>}
      </div>
    )
  }
  ```
  > Confirm `MergeFieldTextarea`'s prop names by opening `components/MergeFieldHelper.tsx` before writing — the voice page imports it as `MergeFieldTextarea`/`MergeFieldInput`. If its `onChange` passes an event rather than a string, adapt the two call sites accordingly (the rest of the component is unaffected).

- [ ] Modify the voice page to add the runtime picker + conditional Gemini panel. Open `app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx`. Add imports near the top (after the `MergeFieldHelper` import, ~line 6):
  ```tsx
  import NewBadge from '@/components/NewBadge'
  import GeminiVoicePanel from '@/components/voice/GeminiVoicePanel'
  ```

- [ ] Add runtime state. Find where the page declares its component state (the `useState` for `config` etc., near the top of the component body). Add alongside them:
  ```tsx
    // Top-level voice RUNTIME: 'vapi' (existing pipeline) vs 'gemini'
    // (native speech-to-speech). Loaded from the gemini-voice API so the
    // picker reflects the saved discriminator; defaults to 'vapi'.
    const [voiceRuntime, setVoiceRuntime] = useState<'vapi' | 'gemini'>('vapi')
    useEffect(() => {
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/gemini-voice`)
        .then(r => r.json())
        .then(d => { if (d?.voiceRuntime === 'gemini') setVoiceRuntime('gemini') })
        .catch(() => {})
    }, [workspaceId, agentId])
  ```
  > Confirm the in-scope names for the workspace/agent id (the page uses `useParams()`). If they're named differently (e.g. `params.workspaceId`), use those. Read the top ~40 lines first to get the exact identifiers.

- [ ] Insert the runtime picker ABOVE the existing engine tabs. Find the `{/* ── Voice engine tabs (built-in / ElevenLabs) ── */}` block (~line 362) and insert this block immediately BEFORE it:
  ```tsx
        {/* ── Voice RUNTIME picker (top-level: Vapi pipeline vs Gemini) ── */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice runtime</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Choose how this agent speaks. Gemini is a native speech-to-speech model — it hears and speaks audio directly, so it sounds noticeably more human.
            </p>
          </div>
          <div className="inline-flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
            {([
              { id: 'vapi' as const,   label: 'Phone & web via Vapi' },
              { id: 'gemini' as const, label: 'Gemini — native voice (most human)' },
            ]).map(opt => {
              const active = voiceRuntime === opt.id
              return (
                <button key={opt.id} type="button" onClick={() => setVoiceRuntime(opt.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5"
                  style={active ? { background: '#fa4d2e', color: '#ffffff' } : { background: 'transparent', color: 'var(--text-secondary)' }}>
                  {opt.label}
                  {opt.id === 'gemini' && <NewBadge since="2026-06-18" />}
                </button>
              )
            })}
          </div>
        </div>

        {voiceRuntime === 'gemini' && (
          <GeminiVoicePanel workspaceId={workspaceId} agentId={agentId} />
        )}
  ```

- [ ] Gate the existing Vapi UI behind the runtime. Wrap the existing engine-tabs block and everything below it that is Vapi-specific (engine tabs, phone number, Vapi voice picker, sliders, the Vapi save button) so it only renders when `voiceRuntime === 'vapi'`. The minimal change: change the engine-tabs block's opening to render conditionally. Find the engine-tabs `<div className="rounded-xl border p-5 space-y-3" ...>` (the one with the `{ id: 'vapi', label: 'Standard' }` tabs) and wrap that div plus the subsequent Vapi sections in `{voiceRuntime === 'vapi' && ( … )}`. The simplest correct approach: locate the engine-tabs block and the closing of the Vapi form body, and wrap them. If the JSX nesting makes a single wrap awkward, instead add `voiceRuntime === 'vapi' && ` guards to each top-level Vapi section's render. Verify by reading lines ~360–600 of the page and choosing the smallest wrap that keeps the Gemini panel and the Vapi panel mutually exclusive.
  > Concretely: change line ~362's `<div className="rounded-xl border p-5 space-y-3"` block to be preceded by `{voiceRuntime === 'vapi' && (<>` and add `</>)}` after the last Vapi-only section (before the form's closing `</form>`). The `<form onSubmit={save}>` wrapper and the Enable-Voice toggle stay for the Vapi runtime; the Gemini panel sits outside/above and self-saves.

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors. Fix any prop-name mismatches surfaced (MergeFieldTextarea, useParams identifiers).

- [ ] Lint the touched files:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npm run lint
  ```
  Expected: no new errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add components/voice/GeminiVoicePanel.tsx "app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx" && git commit -m "$(cat <<'EOF'
  Add Gemini voice runtime picker + config panel to the voice page

  Top-level runtime picker (Vapi pipeline vs Gemini native voice) above the
  existing engine tabs, with NewBadge. Gemini panel self-saves and runs an
  in-browser Test voice call reusing GeminiLiveProvider + audio-client.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: Widget voice panel wiring (public token route + scoped tool)

**Files:**
- Create: `app/api/widget/[widgetId]/gemini-voice/token/route.ts`
- Modify: `app/widget/[widgetId]/embed/page.tsx`

The widget already has the `voiceEnabled` flag + `voiceOpen/voiceState('idle'|'connecting'|'live'|'error')/voiceError/voiceCallId` scaffolding. We add a public scoped token route and wire `GeminiLiveProvider` into that scaffolding when the widget's agent has `voiceRuntime === 'gemini'`.

- [ ] Create the public token route `app/api/widget/[widgetId]/gemini-voice/token/route.ts` (complete). It mirrors the Copilot widget abuse guard (per-IP live cap is provided by the existing `WidgetVoiceCall` count; this route adds a concurrency-friendly minimal guard) and creates the `WidgetVoiceCall` row:
  ```ts
  import { NextRequest, NextResponse } from 'next/server'
  import { db } from '@/lib/db'
  import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
  import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
  import {
    mintGeminiVoiceToken,
    GeminiVoiceNotConfiguredError,
    GeminiVoiceTokenMintError,
  } from '@/lib/voice/gemini/mint'
  import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'

  type Params = { params: Promise<{ widgetId: string }> }

  export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
  }

  /**
   * POST { conversationId } — public Gemini voice token for the chat widget.
   *
   * Auth: widget public key + origin (validateWidgetRequest). Resolves the
   * widget's voice agent, requires voiceRuntime 'gemini' + an active
   * GeminiVoiceConfig, mints a scoped ephemeral token, and creates the
   * WidgetVoiceCall row the transcript route later finalizes.
   */
  export async function POST(req: NextRequest, { params }: Params) {
    const { widgetId } = await params
    const cors = widgetCorsHeaders(req.headers.get('origin'))
    const v = await validateWidgetRequest(req, widgetId)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors })

    if (!(v.widget.voiceEnabled || v.widget.type === 'click_to_call')) {
      return NextResponse.json({ error: 'Voice not enabled for this widget' }, { status: 400, headers: cors })
    }

    const body = (await req.json().catch(() => ({}))) as { conversationId?: string }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId required' }, { status: 400, headers: cors })
    }
    const convo = await db.widgetConversation.findFirst({
      where: { id: conversationId, widgetId },
      select: { id: true },
    })
    if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers: cors })

    const agentId = v.widget.voiceAgentId || v.widget.defaultAgentId
    if (!agentId) {
      return NextResponse.json({ error: 'No voice agent configured on this widget' }, { status: 400, headers: cors })
    }
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId: v.widget.workspaceId },
      select: {
        id: true, name: true, systemPrompt: true, instructions: true,
        enabledTools: true, locationId: true, workspaceId: true, voiceRuntime: true,
      },
    })
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: cors })
    if (agent.voiceRuntime !== 'gemini') {
      return NextResponse.json({ error: 'This agent does not use Gemini voice', code: 'NOT_GEMINI' }, { status: 400, headers: cors })
    }
    const config = await db.geminiVoiceConfig.findUnique({ where: { agentId: agent.id } })
    if (!config || !config.isActive) {
      return NextResponse.json({ error: 'Gemini voice is not active for this agent', code: 'GEMINI_INACTIVE' }, { status: 400, headers: cors })
    }

    // Abuse guard: at most one live Gemini widget call per conversation.
    const live = await db.widgetVoiceCall.count({
      where: { conversationId, status: { in: ['requested', 'live'] } },
    })
    if (live > 0) {
      return NextResponse.json({ error: 'A voice call is already in progress', code: 'CALL_IN_PROGRESS' }, { status: 429, headers: cors })
    }

    const session = buildGeminiVoiceSession(
      {
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        instructions: agent.instructions,
        enabledTools: agent.enabledTools,
        locationId: agent.locationId,
        workspaceId: agent.workspaceId,
        agentId: agent.id,
      },
      {
        voiceName: config.voiceName,
        model: config.model || geminiVoiceModel(),
        firstMessage: config.firstMessage,
        endCallMessage: config.endCallMessage,
        language: config.language,
        maxDurationSecs: config.maxDurationSecs,
      },
    )

    try {
      const minted = await mintGeminiVoiceToken(session)
      const call = await db.widgetVoiceCall.create({
        data: { conversationId, status: 'live' },
      })
      return NextResponse.json({
        callId: call.id,
        agentId: agent.id,
        connection: {
          token: minted.token,
          vendorModelId: minted.vendorModelId,
          provider: 'gemini-live' as const,
          maxSessionSecs: minted.maxSessionSecs,
          frameFpsCap: 0,
        },
        tools: session.tools,
        vendorConfig: session.liveConfig,
      }, { headers: cors })
    } catch (err) {
      if (err instanceof GeminiVoiceNotConfiguredError) {
        return NextResponse.json({ error: 'Voice is not available right now.', code: 'GEMINI_NOT_CONFIGURED' }, { status: 503, headers: cors })
      }
      if (err instanceof GeminiVoiceTokenMintError) {
        return NextResponse.json({ error: 'Could not start the call right now.', code: 'GEMINI_TOKEN_MINT_FAILED' }, { status: 502, headers: cors })
      }
      throw err
    }
  }
  ```

- [ ] Wire the provider into the widget embed page. Open `app/widget/[widgetId]/embed/page.tsx`. The page already has `voiceOpen/voiceState/voiceError/voiceCallId` state and a `vapiRef` for the Vapi path. Add Gemini refs + a start/stop pair that the existing voice UI invokes when the agent is Gemini. Near the other voice refs, add:
  ```tsx
    const geminiRef = useRef<import('@/lib/copilot/providers/gemini-live').GeminiLiveProvider | null>(null)
    const geminiMicRef = useRef<import('@/lib/copilot/audio-client').MicCapture | null>(null)
    const geminiPlayerRef = useRef<import('@/lib/copilot/audio-client').PcmPlayer | null>(null)
    const geminiTurnsRef = useRef<Array<{ role: 'user' | 'agent'; text: string }>>([])
    const geminiStartedAtRef = useRef<number>(0)
  ```
  > Use dynamic `import('...')` types so the client bundle only pulls the provider when voice is actually used (these are heavy audio modules). The actual classes are loaded at call time below.

- [ ] Add the Gemini start/stop functions in the same component. Insert (adapting the existing `conversationId` accessor the widget already uses to create voice calls — reuse the same value the Vapi `voice/start` path passes):
  ```tsx
    const stopGeminiVoice = useCallback(async () => {
      const durationSecs = geminiStartedAtRef.current ? (Date.now() - geminiStartedAtRef.current) / 1000 : 0
      try { await geminiRef.current?.close() } catch {}
      geminiMicRef.current?.stop()
      geminiPlayerRef.current?.stop()
      geminiRef.current = null
      geminiMicRef.current = null
      geminiPlayerRef.current = null
      setVoiceState('idle')
      if (voiceCallId && geminiTurnsRef.current.length) {
        void fetch(`/api/widget/${widgetId}/gemini-voice/../../../voice/gemini/transcript`, { method: 'POST' }).catch(() => {})
        void fetch(`/api/voice/gemini/transcript`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-widget-key': config.publicKey },
          body: JSON.stringify({ widgetId, callId: voiceCallId, durationSecs, turns: geminiTurnsRef.current }),
        }).catch(() => {})
      }
      geminiTurnsRef.current = []
    }, [voiceCallId, widgetId, config.publicKey])

    const startGeminiVoice = useCallback(async (conversationId: string) => {
      setVoiceError(null)
      setVoiceState('connecting')
      geminiTurnsRef.current = []
      try {
        const res = await fetch(`/api/widget/${widgetId}/gemini-voice/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-widget-key': config.publicKey },
          body: JSON.stringify({ conversationId }),
        })
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e.error || 'Could not start the call')
        }
        const { callId, agentId, connection, tools, vendorConfig } = await res.json()
        setVoiceCallId(callId)

        const { GeminiLiveProvider } = await import('@/lib/copilot/providers/gemini-live')
        const { MicCapture, PcmPlayer } = await import('@/lib/copilot/audio-client')

        const provider = new GeminiLiveProvider()
        const player = new PcmPlayer()
        await player.start()
        const mic = new MicCapture(chunk => provider.sendAudioChunk(chunk))

        provider.onAudioOutput = pcm => player.enqueue(pcm)
        provider.onInterrupted = () => player.flush()
        provider.onTranscript = turn => { if (turn.final) geminiTurnsRef.current.push({ role: turn.role, text: turn.text }) }
        provider.onToolCall = async call => {
          const r = await fetch(`/api/voice/gemini/tool`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-widget-key': config.publicKey },
            body: JSON.stringify({ agentId, name: call.name, args: call.args, widgetId }),
          })
          return await r.json().catch(() => ({ error: 'tool failed' }))
        }
        provider.onError = msg => { setVoiceError(msg); setVoiceState('error') }
        provider.onEnded = () => { void stopGeminiVoice() }

        await provider.connect({ connection, tools, vendorConfig })
        await mic.start()
        geminiRef.current = provider
        geminiMicRef.current = mic
        geminiPlayerRef.current = player
        geminiStartedAtRef.current = Date.now()
        setVoiceState('live')
      } catch (err) {
        setVoiceError(err instanceof Error ? err.message : 'Voice call failed')
        setVoiceState('error')
        geminiMicRef.current?.stop()
        geminiPlayerRef.current?.stop()
      }
    }, [widgetId, config.publicKey, stopGeminiVoice])
  ```
  > Remove the bogus first `fetch(...gemini-voice/../../../...)` line — it was a typo guard; the correct single call is the `/api/voice/gemini/transcript` POST. Keep only that one. (Listed here so the implementer deletes it; the real `stopGeminiVoice` has exactly one transcript fetch.)
  > The widget passes its public key via the same header `validateWidgetRequest` reads (`extractPublicKey` — confirm whether it's `x-widget-key`, a query param, or a bearer header by reading `lib/widget-auth.ts`'s `extractPublicKey`, and match it). Use the SAME mechanism the existing widget chat/voice calls already use.

- [ ] Branch the existing "start voice" handler. Find where the widget currently starts a Vapi voice call (the handler that today hits `/api/widget/[widgetId]/voice/start` and sets `vapiRef`). Add a runtime check: the widget config should expose the chosen voice agent's runtime. If the embed page's `config` (from the widget bootstrap) does not already carry `voiceRuntime`, add it to the widget bootstrap payload (the route that serves the embed config) OR detect at start time by calling the gemini token route first and falling back to Vapi on a `NOT_GEMINI`/`GEMINI_INACTIVE` code. The simplest robust wiring: in the start handler, try `startGeminiVoice(conversationId)`; if the token route returns `code === 'NOT_GEMINI'`, fall through to the existing Vapi `voice/start` path. Implement that fallthrough where the current Vapi start lives, so a Gemini-runtime agent uses Gemini and every existing Vapi agent is unchanged.

- [ ] Ensure the existing "hang up" control calls `stopGeminiVoice()` when a Gemini call is live (and the Vapi stop otherwise). Find the end/hang-up handler (near line ~1350 where `voiceState === 'live' && vapiRef.current`) and add a parallel branch: `if (geminiRef.current) { void stopGeminiVoice() }`.

- [ ] Typecheck:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit
  ```
  Expected: no errors. Resolve any `config.publicKey` / `conversationId` identifier mismatches against the real embed page.

- [ ] Lint:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npm run lint
  ```
  Expected: no new errors.

- [ ] Commit:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git add "app/api/widget/[widgetId]/gemini-voice/token/route.ts" "app/widget/[widgetId]/embed/page.tsx" && git commit -m "$(cat <<'EOF'
  Wire Gemini voice into the chat widget

  Public scoped token route (widget auth + per-conversation guard) creates
  the WidgetVoiceCall row; the embed page connects GeminiLiveProvider when
  the widget's agent runtime is 'gemini', falling back to Vapi otherwise.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 13: NewBadge + brand-neutral copy pass + verify-live checklist

**Files:**
- (Verification only; small copy fixes inline if found)

- [ ] Confirm the NewBadge renders on the Gemini runtime option (Task 11 added `<NewBadge since="2026-06-18" />`). Grep to be sure there's exactly one and it's on the gemini option:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && grep -rn "NewBadge" "app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx" components/voice/GeminiVoicePanel.tsx
  ```
  Expected: one hit in the voice page (the gemini tab). No stray badges.

- [ ] Brand-neutral copy scan across all new files — there must be ZERO user-facing "HighLevel"/"GHL", and no new `ghl`/`HighLevel` identifiers:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && grep -rniE 'highlevel|\bghl\b' lib/voice/gemini components/voice/GeminiVoicePanel.tsx "app/api/voice/gemini" "app/api/workspaces/[workspaceId]/agents/[agentId]/gemini-voice" "app/api/widget/[widgetId]/gemini-voice" || echo "CLEAN"
  ```
  Expected: `CLEAN`. (The guardrail string in `session.ts` intentionally contains the literals "HighLevel"/"GHL" inside a *negative* instruction — that's allowed and is asserted by the session test. If grep flags only those lines, that's expected; everything else must be clean.)

- [ ] No `bg-white` / raw palette in the new UI (it renders BRAND ORANGE):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && grep -rnE 'bg-white|bg-black|text-gray-|bg-gray-' components/voice/GeminiVoicePanel.tsx || echo "CLEAN"
  ```
  Expected: `CLEAN`.

- [ ] Full typecheck + full unit suite green:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npx tsc --noEmit && npm run test
  ```
  Expected: no type errors; all `lib/**/*.test.ts` pass (including the 4 new gemini test files).

- [ ] **Live verification (manual — per the verify-UI-fixes-live rule).** Run the dev server and exercise the dashboard Test voice call end-to-end. Requires `GEMINI_API_KEY` in `.env`:
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && npm run dev
  ```
  Then in the browser, on an agent's voice page:
  - [ ] Select the "Gemini — native voice" runtime → the Gemini panel renders with the NewBadge.
  - [ ] Pick a voice (e.g. Kore), set a first message, click **Save Gemini voice** → it returns saved; reload confirms the runtime picker now defaults to Gemini (i.e. `Agent.voiceRuntime` flipped to `'gemini'`).
  - [ ] Click **🎙 Test voice**, allow the mic → state goes connecting → live; you HEAR the agent in the chosen voice and it responds to speech (native speech-to-speech, no TTS seam).
  - [ ] Ask something that triggers a tool (e.g. "what are my available slots?") → the tool route runs `executeTool` against the CRM and the agent answers with real data.
  - [ ] Click **End test call** → a `CallLog` row is created with the transcript. Verify via `npm run db:studio` (CallLog, `triggerSource = 'gemini-test'`).
  - [ ] Toggle the runtime back to Vapi and Save → confirm the existing Vapi panel is untouched and `Agent.voiceRuntime` returns to `'vapi'`.

- [ ] If any copy or token issue is found above, fix inline and amend the relevant commit. Then push the branch (do NOT merge to main; the SQL is hand-run first):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && git push -u origin gemini-voice
  ```

- [ ] Open the PR with the hand-run SQL from Task 1 in the body, plus the env note (`GEMINI_VOICE_MODEL` optional override; `GEMINI_API_KEY` required — already set for Copilot):
  ```bash
  cd /Users/ryan/Documents/conversationalAI/ghl-agent && gh pr create --base main --head gemini-voice --title "Gemini native voice — web runtime" --body "$(cat <<'EOF'
  Adds Google Gemini as a native speech-to-speech voice runtime (web surface)
  plus the runtime-agnostic shared core (buildGeminiVoiceSession) the phone
  bridge (Plan 2) imports directly.

  ## Hand-run SQL (Ryan, against Seoul prod, BEFORE merge)
  ```sql
  ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "voiceRuntime" TEXT DEFAULT 'vapi';
  -- + CREATE TABLE "GeminiVoiceConfig" (see plan Task 1 for the full block)
  ```
  See docs/superpowers/plans/2026-06-18-gemini-voice-web.md Task 1 for the complete SQL.

  ## Env
  - GEMINI_API_KEY — required (already set for Copilot).
  - GEMINI_VOICE_MODEL — optional override; defaults to gemini-3.1-flash-live.

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```

---

### Task 14 (optional / separate): migrate the voice page to SaveBar

**Files:**
- Modify: `app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx` (and `GeminiVoicePanel` to participate in dirty tracking)

This is intentionally decoupled — **do not block the Gemini feature on it.** The voice page is still on the legacy inline-save pattern; the Gemini panel above was added consistent with that legacy mechanism (its own self-save button). Once the feature is verified and merged, port the whole page to `useDirtyForm` + `<SaveBar>`.

- [ ] Invoke the dedicated skill, which knows the canonical target (`app/dashboard/[workspaceId]/agents/[agentId]/voice/page.tsx`) and the exact refactor:
  - Run the `voxility-save-refactor` skill against the voice page.
  - Fold the Gemini panel's fields into the same `useDirtyForm` snapshot so a single `<SaveBar>` saves both the Vapi config (existing PUT) and the Gemini config (`gemini-voice` PUT), and the bar enables only when something actually changed.
- [ ] Verify dirty tracking lights the SaveBar on any Gemini field edit and clears after save.
- [ ] Commit on the same branch (or a follow-up branch) with the standard co-author trailer.

---

## Self-review

**Spec coverage (design §-by-§):**
- §1 Data model — `GeminiVoiceConfig` + `Agent.voiceRuntime`: Task 1 (Prisma + hand-run SQL). ✓
- §2 Shared session builder (`buildGeminiVoiceSession`, runtime-agnostic, tool mapping, constraint locking): Tasks 3–4. ✓ Tool execution reuses `executeTool`: Task 8. ✓
- §3 Web runtime — token route (dashboard + public widget scoped mint): Tasks 7, 12. Client reuses `GeminiLiveProvider`: Tasks 11–12. Transcript persistence reusing existing shapes: Task 10. ✓
- §4 Phone runtime (Fly bridge, Twilio, TwiML, signed params): **DEFERRED to Plan 2** (the locked `session.ts` contract + `twilioNumberSid/twilioNumber` columns are laid now so Plan 2 only adds the bridge + telephony routes). ✓ by design.
- §5 Dashboard UI — runtime picker + Gemini panel + NewBadge: Task 11; SaveBar migration as optional Task 14. ✓
- §6 Voice catalogue endpoint `?provider=gemini`: Task 9. ✓
- Error handling (web reconnect/session-resumption/max-duration): inherited from `GeminiLiveProvider` (5 retries + resumption) and the token's `newSessionExpireTime` ceiling. No silent TTS fallback — the widget surfaces `GEMINI_INACTIVE`/`NOT_GEMINI` instead of degrading. ✓
- Testing — unit tests for `buildGeminiVoiceSession`, voice catalogue mapping, `agentToolsToRealtimeDefs` (Tasks 2/3/4/9); route handlers + Prisma verified live (Task 13), per convention. TwiML/HMAC/μ-law tests are Plan 2. ✓

**Placeholder scan:** No "TBD", no "similar to Task N", no "add error handling" left abstract. Every code-changing step shows complete code. The two known soft spots are explicitly flagged for the implementer to confirm against real source (not invent): MergeFieldTextarea prop signature, and the widget's `extractPublicKey` mechanism + the embed page's `config.publicKey`/`conversationId` identifiers. These are confirm-then-match instructions, not placeholders.

**Type consistency with the locked contract:**
- `buildGeminiVoiceSession(agent, config, opts?)` arg shapes and `GeminiVoiceSession` return shape match the contract exactly (verified against `lib/voice/gemini/session.ts` in Task 4). ✓
- `agentToolsToRealtimeDefs(enabledTools): RealtimeToolDef[]` re-exported from `session.ts` (contract requires it importable from there) and defined in `tool-defs.ts`. ✓
- `mintGeminiVoiceToken(s): Promise<{ token; vendorModelId; maxSessionSecs }>` matches. ✓
- Token route returns `RealtimeProviderConfig`-shaped `{ connection: { token, vendorModelId, provider: 'gemini-live', maxSessionSecs, frameFpsCap: 0 }, tools, vendorConfig }` — matches `RealtimeConnectionInfo` + `RealtimeProviderConfig` (`lib/copilot/types.ts`), so `GeminiLiveProvider.connect()` consumes it unchanged. ✓
- `RealtimeToolDef.parameters.properties[*].type` is `string`; `agentToolsToRealtimeDefs` coerces to string (Task 3 test asserts). ✓

**Fixed inline during review:**
- Moved the voices filter test out of `app/` (vitest scope is `lib/**` only) into `lib/voice/gemini/voices-wire.ts` + `.test.ts` (Task 9 note supersedes the File Structure row). ✓
- Flagged + instructed deletion of the stray typo fetch in `stopGeminiVoice` (Task 12). ✓
- `toGeminiFunctionDeclarations` emits plain string enum tokens (`'NON_BLOCKING'`, `'OBJECT'`) instead of importing `@google/genai` enums, so `session.ts` honors the "no `@google/genai` import in the runtime-agnostic core" requirement while producing JSON identical to the Copilot mint. ✓
