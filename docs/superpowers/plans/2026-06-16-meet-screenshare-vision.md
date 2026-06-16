# Meet Screen-Share Vision — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Recall meeting bot see a participant's shared screen on Google Meet/Zoom/Teams and feed those frames to its live Gemini session, so it guides on what's on screen.

**Architecture:** A new always-on Fly.io websocket **relay worker** receives Recall's real-time screenshare frames (push model) and forwards them, paired by `botToken`, into the bot's existing headless page, which already runs Gemini and pipes audio both ways. The page hands frames to the unused `provider.sendVideoFrame()`. Gemini, audio, and the bot tile are untouched.

**Tech Stack:** Worker = Node + `ws` + TypeScript (run via `tsx`), tested with Vitest, deployed via Docker to Fly.io. App = existing Next.js 16 / `ghl-agent`.

**Spec:** `docs/superpowers/specs/2026-06-16-meet-screenshare-vision-design.md`

**Worker location:** `ghl-agent/recall-video-worker/` (inside the repo for version control; excluded from the Next build/typecheck; deployed to Fly separately).

---

## Phase 1 — The relay worker (greenfield, TDD)

### Task 1: Scaffold the worker project

**Files:**
- Create: `recall-video-worker/package.json`
- Create: `recall-video-worker/tsconfig.json`
- Create: `recall-video-worker/.gitignore`
- Create: `recall-video-worker/src/.gitkeep`

- [ ] **Step 1: Create `recall-video-worker/package.json`**

```json
{
  "name": "recall-video-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ws": "^8.18.0",
    "tsx": "^4.19.1"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "@types/ws": "^8.5.12",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Create `recall-video-worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `recall-video-worker/.gitignore`**

```
node_modules
*.log
```

- [ ] **Step 4: Create `recall-video-worker/src/.gitkeep`** (empty file, so the dir exists)

- [ ] **Step 5: Install deps**

Run: `cd recall-video-worker && npm install`
Expected: completes, creates `node_modules` + `package-lock.json`.

- [ ] **Step 6: Keep the worker out of the Next app's typecheck/lint**

Read `tsconfig.json` (the `ghl-agent` one) and add `"recall-video-worker"` to its `exclude` array (create `exclude` if absent). Then read `eslint.config.*` / `.eslintignore` and add `recall-video-worker/` to the ignore list.

Run: `./node_modules/.bin/tsc --noEmit` (from `ghl-agent` root)
Expected: exit 0 (worker files not typechecked by the app).

- [ ] **Step 7: Commit**

```bash
git add recall-video-worker/package.json recall-video-worker/tsconfig.json recall-video-worker/.gitignore recall-video-worker/src/.gitkeep tsconfig.json
git commit -m "chore(worker): scaffold recall-video-worker"
```

---

### Task 2: Recall event parser (pure, TDD)

**Files:**
- Create: `recall-video-worker/src/recall-events.ts`
- Test: `recall-video-worker/test/recall-events.test.ts`

> Recall's real-time `video_separate_png.data` event carries a per-participant PNG frame with a `type` of `webcam` or `screenshare`. We parse defensively and only care about screenshare frames. (Exact field nesting is verified against a real payload in Task 11; this shape is the documented assumption and the server logs the first raw payload to confirm.)

- [ ] **Step 1: Write the failing test** — `recall-video-worker/test/recall-events.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseRecallMessage } from '../src/recall-events.js'

const frame = (type: string, buffer = 'AAAA') =>
  JSON.stringify({
    event: 'video_separate_png.data',
    data: { data: { buffer, type, timestamp: { relative: 1.5 } }, participant: { id: 7 } },
  })

describe('parseRecallMessage', () => {
  it('parses a screenshare frame', () => {
    expect(parseRecallMessage(frame('screenshare'))).toEqual({
      kind: 'frame', isScreenshare: true, pngBase64: 'AAAA', ts: 1.5,
    })
  })
  it('marks a webcam frame as not screenshare', () => {
    expect(parseRecallMessage(frame('webcam'))).toMatchObject({ kind: 'frame', isScreenshare: false })
  })
  it('ignores other event types', () => {
    expect(parseRecallMessage(JSON.stringify({ event: 'transcript.data', data: {} }))).toEqual({ kind: 'ignore' })
  })
  it('ignores malformed JSON', () => {
    expect(parseRecallMessage('not json')).toEqual({ kind: 'ignore' })
  })
  it('ignores a frame with no buffer', () => {
    expect(parseRecallMessage(JSON.stringify({ event: 'video_separate_png.data', data: { data: { type: 'screenshare' } } }))).toEqual({ kind: 'ignore' })
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd recall-video-worker && npm test`
Expected: FAIL — `parseRecallMessage` not found.

- [ ] **Step 3: Implement** — `recall-video-worker/src/recall-events.ts`

```ts
export type ParsedRecallEvent =
  | { kind: 'frame'; isScreenshare: boolean; pngBase64: string; ts: number }
  | { kind: 'ignore' }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export function parseRecallMessage(raw: string | Buffer): ParsedRecallEvent {
  let msg: unknown
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'))
  } catch {
    return { kind: 'ignore' }
  }
  if (!isRecord(msg) || msg.event !== 'video_separate_png.data') return { kind: 'ignore' }
  const outer = isRecord(msg.data) ? msg.data : undefined
  const inner = outer && isRecord(outer.data) ? outer.data : undefined
  const buffer = inner && typeof inner.buffer === 'string' ? inner.buffer : undefined
  if (!buffer) return { kind: 'ignore' }
  const type = inner && typeof inner.type === 'string' ? inner.type : ''
  const ts = inner && isRecord(inner.timestamp) && typeof inner.timestamp.relative === 'number' ? inner.timestamp.relative : 0
  return { kind: 'frame', isScreenshare: type === 'screenshare', pngBase64: buffer, ts }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd recall-video-worker && npm test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add recall-video-worker/src/recall-events.ts recall-video-worker/test/recall-events.test.ts
git commit -m "feat(worker): parse Recall video_separate_png events"
```

---

### Task 3: Room registry + forwarding (pure, TDD)

**Files:**
- Create: `recall-video-worker/src/rooms.ts`
- Test: `recall-video-worker/test/rooms.test.ts`

> A room pairs the Recall ingest socket and the bot-page relay socket by `botToken`. Only screenshare frames are forwarded; identical consecutive frames are deduped. Sinks are abstracted behind a `Sink` interface so tests use fakes.

- [ ] **Step 1: Write the failing test** — `recall-video-worker/test/rooms.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { RoomRegistry, type Sink } from '../src/rooms.js'

function fakeSink() {
  const sent: string[] = []
  return { sink: { send: (d: string) => sent.push(d) } as Sink, sent }
}
const frame = (type: string, buffer = 'AAAA') =>
  JSON.stringify({ event: 'video_separate_png.data', data: { data: { buffer, type, timestamp: { relative: 1 } }, participant: { id: 7 } } })

describe('RoomRegistry', () => {
  it('forwards a screenshare frame from recall to the agent', () => {
    const reg = new RoomRegistry()
    const agent = fakeSink()
    reg.attachAgent('tok', agent.sink)
    reg.attachRecall('tok', fakeSink().sink)
    expect(reg.handleRecallMessage('tok', frame('screenshare'))).toBe(true)
    expect(JSON.parse(agent.sent[0])).toMatchObject({ type: 'frame', mime: 'image/png', data: 'AAAA' })
  })
  it('drops webcam frames', () => {
    const reg = new RoomRegistry()
    const agent = fakeSink()
    reg.attachAgent('tok', agent.sink)
    expect(reg.handleRecallMessage('tok', frame('webcam'))).toBe(false)
    expect(agent.sent).toHaveLength(0)
  })
  it('dedupes identical consecutive frames', () => {
    const reg = new RoomRegistry()
    const agent = fakeSink()
    reg.attachAgent('tok', agent.sink)
    reg.handleRecallMessage('tok', frame('screenshare', 'X'))
    reg.handleRecallMessage('tok', frame('screenshare', 'X'))
    reg.handleRecallMessage('tok', frame('screenshare', 'Y'))
    expect(agent.sent).toHaveLength(2)
  })
  it('does not throw when no agent socket is attached', () => {
    const reg = new RoomRegistry()
    expect(reg.handleRecallMessage('tok', frame('screenshare'))).toBe(false)
  })
  it('drops the room once both sides detach', () => {
    const reg = new RoomRegistry()
    reg.attachAgent('tok', fakeSink().sink)
    reg.attachRecall('tok', fakeSink().sink)
    reg.detachAgent('tok')
    reg.detachRecall('tok')
    expect(reg.roomCount()).toBe(0)
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd recall-video-worker && npm test`
Expected: FAIL — `RoomRegistry` not found.

- [ ] **Step 3: Implement** — `recall-video-worker/src/rooms.ts`

```ts
import { parseRecallMessage } from './recall-events.js'

export interface Sink {
  send(data: string): void
}

interface Room {
  recall?: Sink
  agent?: Sink
  lastFrame?: string
}

export class RoomRegistry {
  private rooms = new Map<string, Room>()

  private getOrCreate(token: string): Room {
    let r = this.rooms.get(token)
    if (!r) {
      r = {}
      this.rooms.set(token, r)
    }
    return r
  }

  attachRecall(token: string, sink: Sink): void {
    this.getOrCreate(token).recall = sink
  }
  attachAgent(token: string, sink: Sink): void {
    this.getOrCreate(token).agent = sink
  }
  detachRecall(token: string): void {
    const r = this.rooms.get(token)
    if (!r) return
    r.recall = undefined
    this.cleanup(token)
  }
  detachAgent(token: string): void {
    const r = this.rooms.get(token)
    if (!r) return
    r.agent = undefined
    this.cleanup(token)
  }

  /** Handle one raw message from the Recall ingest socket. Returns whether a frame was forwarded. */
  handleRecallMessage(token: string, raw: string | Buffer): boolean {
    const r = this.rooms.get(token)
    if (!r || !r.agent) return false
    const parsed = parseRecallMessage(raw)
    if (parsed.kind !== 'frame' || !parsed.isScreenshare) return false
    if (parsed.pngBase64 === r.lastFrame) return false
    r.lastFrame = parsed.pngBase64
    r.agent.send(JSON.stringify({ type: 'frame', mime: 'image/png', data: parsed.pngBase64, ts: parsed.ts }))
    return true
  }

  private cleanup(token: string): void {
    const r = this.rooms.get(token)
    if (r && !r.recall && !r.agent) this.rooms.delete(token)
  }

  roomCount(): number {
    return this.rooms.size
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd recall-video-worker && npm test`
Expected: PASS (all recall-events + rooms tests).

- [ ] **Step 5: Commit**

```bash
git add recall-video-worker/src/rooms.ts recall-video-worker/test/rooms.test.ts
git commit -m "feat(worker): room registry pairs recall+agent and forwards screenshare frames"
```

---

### Task 4: WebSocket server + integration test

**Files:**
- Create: `recall-video-worker/src/server.ts`
- Test: `recall-video-worker/test/server.test.ts`

- [ ] **Step 1: Write the failing integration test** — `recall-video-worker/test/server.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { createWorker } from '../src/server.js'

const once = (ws: WebSocket, ev: string) => new Promise<any>(res => ws.once(ev, res))

describe('worker server', () => {
  it('relays a screenshare frame from /recall to /agent', async () => {
    const { server } = createWorker()
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port

    const agent = new WebSocket(`ws://localhost:${port}/agent/tok123`)
    await once(agent, 'open')
    const recall = new WebSocket(`ws://localhost:${port}/recall/tok123`)
    await once(recall, 'open')

    const got = once(agent, 'message')
    recall.send(JSON.stringify({ event: 'video_separate_png.data', data: { data: { buffer: 'ZZZ', type: 'screenshare', timestamp: { relative: 2 } }, participant: { id: 1 } } }))
    const msg = await got
    expect(JSON.parse(msg.toString())).toMatchObject({ type: 'frame', mime: 'image/png', data: 'ZZZ' })

    agent.close(); recall.close()
    await new Promise<void>(r => server.close(() => r()))
  })

  it('rejects an unknown path', async () => {
    const { server } = createWorker()
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const bad = new WebSocket(`ws://localhost:${port}/nope`)
    const err = await once(bad, 'error').then(() => true).catch(() => true)
    expect(err).toBe(true)
    await new Promise<void>(r => server.close(() => r()))
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `cd recall-video-worker && npm test`
Expected: FAIL — `createWorker` not found.

- [ ] **Step 3: Implement** — `recall-video-worker/src/server.ts`

```ts
import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import { RoomRegistry } from './rooms.js'

const PATH_RE = /^\/(recall|agent)\/([A-Za-z0-9_-]{16,})$/

export function createWorker(): { server: Server; registry: RoomRegistry } {
  const registry = new RoomRegistry()
  const server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`ok rooms=${registry.roomCount()}`)
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost')
    const m = pathname.match(PATH_RE)
    if (!m) {
      socket.destroy()
      return
    }
    const role = m[1] as 'recall' | 'agent'
    const token = m[2]
    wss.handleUpgrade(req, socket, head, ws => {
      const sink = { send: (d: string) => { try { ws.send(d) } catch {} } }
      if (role === 'recall') {
        registry.attachRecall(token, sink)
        let logged = false
        ws.on('message', data => {
          if (!logged) { logged = true; console.log(`[worker] first recall payload for ${token.slice(0, 6)}…:`, data.toString().slice(0, 300)) }
          try { registry.handleRecallMessage(token, data.toString()) } catch (e) { console.warn('[worker] handle error', e) }
        })
        ws.on('close', () => registry.detachRecall(token))
      } else {
        registry.attachAgent(token, sink)
        ws.on('close', () => registry.detachAgent(token))
      }
    })
  })

  return { server, registry }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const port = Number(process.env.PORT) || 8080
  const { server } = createWorker()
  server.listen(port, () => console.log(`[recall-video-worker] listening on :${port}`))
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd recall-video-worker && npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Typecheck**

Run: `cd recall-video-worker && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add recall-video-worker/src/server.ts recall-video-worker/test/server.test.ts
git commit -m "feat(worker): ws server with /recall and /agent socket roles"
```

---

### Task 5: Docker + Fly config + README

**Files:**
- Create: `recall-video-worker/Dockerfile`
- Create: `recall-video-worker/.dockerignore`
- Create: `recall-video-worker/fly.toml`
- Create: `recall-video-worker/README.md`

- [ ] **Step 1: Create `recall-video-worker/Dockerfile`**

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY tsconfig.json ./
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start"]
```

- [ ] **Step 2: Create `recall-video-worker/.dockerignore`**

```
node_modules
test
*.log
```

- [ ] **Step 3: Create `recall-video-worker/fly.toml`**

```toml
app = "voxility-recall-worker"
primary_region = "sjc"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[http_service.checks]]
  method = "get"
  path = "/healthz"
  interval = "15s"
  timeout = "2s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

- [ ] **Step 4: Create `recall-video-worker/README.md`**

````markdown
# recall-video-worker

Relays a Recall.ai bot's real-time screenshare frames into the Voxility meeting-bot
page so the live Gemini session can see the shared screen.

- `wss://<host>/recall/:botToken` — Recall pushes `video_separate_png.data` here.
- `wss://<host>/agent/:botToken` — the bot page connects here; receives `{type:'frame',mime,data,ts}`.

Paired by `botToken`. Screenshare frames only; identical frames deduped. No durable state.

## Local
```bash
npm install
npm test
npm run dev   # listens on :8080
```

## Deploy (Fly.io)
```bash
fly launch --no-deploy   # first time only; app name voxility-recall-worker, region sjc
fly deploy
```
Then set `RECALL_VIDEO_WORKER_WS_HOST=voxility-recall-worker.fly.dev` in the ghl-agent (Vercel) env.
````

- [ ] **Step 5: Commit**

```bash
git add recall-video-worker/Dockerfile recall-video-worker/.dockerignore recall-video-worker/fly.toml recall-video-worker/README.md
git commit -m "chore(worker): Docker + Fly config + README"
```

---

## Phase 2 — Wire `ghl-agent` (run all commands from `ghl-agent/`)

### Task 6: Make `sendVideoFrame` accept PNG

**Files:**
- Modify: `lib/copilot/providers/gemini-live.ts` (the `sendVideoFrame` method)
- Modify: `lib/copilot/types.ts` (the `RealtimeModelProvider.sendVideoFrame` signature)

- [ ] **Step 1: Update the provider method.** In `lib/copilot/providers/gemini-live.ts`, replace:

```ts
  sendVideoFrame(base64Jpeg: string): void {
    this.session?.sendRealtimeInput({
      video: { data: base64Jpeg, mimeType: 'image/jpeg' },
    })
  }
```

with:

```ts
  sendVideoFrame(base64Image: string, mimeType: string = 'image/jpeg'): void {
    this.session?.sendRealtimeInput({
      video: { data: base64Image, mimeType },
    })
  }
```

- [ ] **Step 2: Update the interface.** In `lib/copilot/types.ts`, replace the line:

```ts
  /** Push one throttled screen frame (base64 JPEG). */
  sendVideoFrame(base64Jpeg: string): void
```

with:

```ts
  /** Push one screen frame (base64 image). mimeType defaults to JPEG; the meeting relay sends PNG. */
  sendVideoFrame(base64Image: string, mimeType?: string): void
```

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0 (existing JPEG callers unaffected — second arg optional).

- [ ] **Step 4: Commit**

```bash
git add lib/copilot/providers/gemini-live.ts lib/copilot/types.ts
git commit -m "feat(copilot): sendVideoFrame accepts an explicit mimeType (PNG for meetings)"
```

---

### Task 7: Recall real-time video endpoint (TDD on the pure helper)

**Files:**
- Modify: `lib/copilot/recall.ts` (add helper + wire into `createMeetingBot`)
- Modify: `lib/copilot/session-service.ts:695` (pass `botToken` to `createMeetingBot`)
- Test: `lib/copilot/recall.test.ts`

- [ ] **Step 1: Write the failing test** — `lib/copilot/recall.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { buildMeetingRealtimeEndpoints } from './recall'

afterEach(() => { delete process.env.RECALL_VIDEO_WORKER_WS_HOST })

describe('buildMeetingRealtimeEndpoints', () => {
  it('returns [] when no worker host is configured', () => {
    expect(buildMeetingRealtimeEndpoints('tok123')).toEqual([])
  })
  it('builds a websocket video endpoint when the host is set', () => {
    process.env.RECALL_VIDEO_WORKER_WS_HOST = 'voxility-recall-worker.fly.dev'
    expect(buildMeetingRealtimeEndpoints('tok123')).toEqual([
      { type: 'websocket', url: 'wss://voxility-recall-worker.fly.dev/recall/tok123', events: ['video_separate_png.data'] },
    ])
  })
})
```

- [ ] **Step 2: Run it, expect failure**

Run: `npm run test -- recall.test.ts`
Expected: FAIL — `buildMeetingRealtimeEndpoints` not exported.

- [ ] **Step 3: Add the helper.** In `lib/copilot/recall.ts`, just above `createMeetingBot`, add:

```ts
/**
 * Real-time video endpoint so the bot streams the shared screen to our relay
 * worker. Returns [] when RECALL_VIDEO_WORKER_WS_HOST is unset — the bot then
 * runs audio-only (the feature is off, gracefully).
 */
export function buildMeetingRealtimeEndpoints(botToken: string): Array<Record<string, unknown>> {
  const host = process.env.RECALL_VIDEO_WORKER_WS_HOST
  if (!host) return []
  return [{ type: 'websocket', url: `wss://${host}/recall/${botToken}`, events: ['video_separate_png.data'] }]
}
```

- [ ] **Step 4: Wire it into `createMeetingBot`.** Change the `opts` type to add `botToken` and include `recording_config` in the payload. Replace the `createMeetingBot` signature + body up to the `recallFetch` call:

```ts
export async function createMeetingBot(opts: {
  meetingUrl: string
  botName: string
  webpageUrl: string
  botToken: string
}): Promise<RecallBot> {
  const variant = process.env.RECALL_BOT_VARIANT || 'web_4_core'
  const realtimeEndpoints = buildMeetingRealtimeEndpoints(opts.botToken)
  const res = await recallFetch('/api/v1/bot/', {
    method: 'POST',
    body: JSON.stringify({
      meeting_url: opts.meetingUrl,
      bot_name: opts.botName.slice(0, 64),
      output_media: {
        camera: { kind: 'webpage', config: { url: opts.webpageUrl } },
      },
      variant: { zoom: variant, google_meet: variant, microsoft_teams: variant },
      ...(realtimeEndpoints.length ? { recording_config: { realtime_endpoints: realtimeEndpoints } } : {}),
    }),
  })
```

(Leave the rest of `createMeetingBot` — the response handling — unchanged.)

- [ ] **Step 5: Pass `botToken` at the call site.** In `lib/copilot/session-service.ts` around line 695, update the `createMeetingBot` call:

```ts
    const bot = await createMeetingBot({
      meetingUrl,
      botName: agent.name,
      webpageUrl: `${appOrigin()}/copilot/bot/${botToken}`,
      botToken,
    })
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run test -- recall.test.ts && ./node_modules/.bin/tsc --noEmit`
Expected: test PASS (2), tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/copilot/recall.ts lib/copilot/recall.test.ts lib/copilot/session-service.ts
git commit -m "feat(copilot): attach Recall real-time screenshare endpoint to meeting bots"
```

---

### Task 8: Return the relay URL from connect

**Files:**
- Modify: `lib/copilot/session-service.ts` (`connectMeetingSession` return, ~line 787)

> The connect route already does `{ ok: true, ...result }`, so adding a field here surfaces it to the bot page automatically.

- [ ] **Step 1: Add `videoRelayUrl` to the return.** In `connectMeetingSession`, replace the final `return { ... }` (lines ~787-793) with:

```ts
  const videoRelayHost = process.env.RECALL_VIDEO_WORKER_WS_HOST
  const videoRelayUrl = videoRelayHost ? `wss://${videoRelayHost}/agent/${botToken}` : null

  return {
    sessionId: session.id,
    realtime,
    liveConfig,
    tools: MEETING_TOOL_DEFS,
    display: { agentName: agent.name, workspaceName: workspace?.name ?? '' },
    videoRelayUrl,
  }
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/copilot/session-service.ts
git commit -m "feat(copilot): return videoRelayUrl from meeting connect"
```

---

### Task 9: Bot page consumes the relay socket

**Files:**
- Modify: `app/copilot/bot/[botToken]/page.tsx`

- [ ] **Step 1: Add a socket ref.** Near the other refs at the top of the component (alongside `providerRef`), add:

```ts
  const videoSocketRef = useRef<WebSocket | null>(null)
```

- [ ] **Step 2: Read the new field from the connect response.** In the `start()` body, extend the `body` type to include `videoRelayUrl?: string | null` (add it to the inline type at the `const body = (... ) as { ... }` near line 116).

- [ ] **Step 3: Open the relay after Gemini connects.** Immediately after the `await provider.connect({ ... })` call (currently ~line 177), add:

```ts
        if (body.videoRelayUrl) {
          let relayBackoff = 1000
          const openRelay = () => {
            if (endedRef.current) return
            const ws = new WebSocket(body.videoRelayUrl!)
            videoSocketRef.current = ws
            ws.onopen = () => { relayBackoff = 1000 }
            ws.onmessage = ev => {
              try {
                const m = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as { type?: string; mime?: string; data?: string }
                if (m.type === 'frame' && typeof m.data === 'string') {
                  providerRef.current?.sendVideoFrame(m.data, m.mime || 'image/png')
                }
              } catch {
                // ignore malformed relay frames
              }
            }
            ws.onclose = () => {
              videoSocketRef.current = null
              if (!endedRef.current) {
                relayBackoff = Math.min(relayBackoff * 2, 15000)
                setTimeout(openRelay, relayBackoff)
              }
            }
            ws.onerror = () => ws.close()
          }
          openRelay()
        }
```

> This references an `endedRef` (a `useRef(false)` set to `true` when the session ends). If the component does not already have one, add `const endedRef = useRef(false)` with the other refs and set `endedRef.current = true` at the top of `endSession`. (Check the existing `endSession`/cleanup first — the page already tracks an ended state via `setPhase('ended')`; reuse an existing ref if present rather than adding a duplicate.)

- [ ] **Step 4: Close the relay on teardown.** In the `useEffect` cleanup at the end of this effect (where `flushTimer`/`speakTimer` are cleared), add:

```ts
      videoSocketRef.current?.close()
      videoSocketRef.current = null
```

Also call `videoSocketRef.current?.close()` at the start of `endSession` so a normal end stops reconnects.

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "app/copilot/bot/[botToken]/page.tsx"
git commit -m "feat(copilot): bot page feeds relayed screenshare frames to Gemini"
```

---

### Task 10: Teach the meeting prompt it can see shared screens

**Files:**
- Modify: `lib/copilot/prompt.ts` (`buildMeetingPrompt`, the "Meeting behaviour" bullet)

- [ ] **Step 1: Replace the "cannot see" rule.** In `buildMeetingPrompt`, replace this bullet:

```ts
    `- YOU CANNOT SEE ANYTHING. No shared screens, no cameras, no chat messages. You only hear audio. If someone shares a screen or refers to something visual ("can you see this?", "what do I click here?"), say plainly that you can't see their screen and ask them to read out or describe what's in front of them. NEVER pretend to see, and never guess at what's on a screen.`,
```

with:

```ts
    `- You can SEE a participant's SHARED SCREEN — but ONLY while someone is actively screen-sharing, and nothing else (no cameras or faces, no chat). The shared view is low-resolution and updates only a couple of times a second, so guide on what app, page, or section is shown rather than reading small text or exact values; if you genuinely can't make something out, ask them to read it. When NO ONE is sharing you see nothing — say so plainly and ask them to share their screen. Never pretend to see a screen that isn't being shared, and never guess.`,
```

- [ ] **Step 2: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run the copilot unit tests** (ensure nothing regressed)

Run: `npm run test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add lib/copilot/prompt.ts
git commit -m "feat(copilot): meeting bot can see shared screens (prompt)"
```

---

## Phase 3 — Going live (operator-run)

This phase is intentionally **non-technical and lives in its own runbook** so a non-engineer can
follow it: **`docs/superpowers/plans/2026-06-16-meet-screenshare-GOLIVE-runbook.md`**. It covers, in
plain English with copy-paste commands and what-you-should-see after each: (A) deploy the worker to
Fly.io, (B) set `RECALL_VIDEO_WORKER_WS_HOST=voxility-recall-worker.fly.dev` in Vercel (Prod + Dev)
and redeploy, (C) test on a real Google Meet.

**Engineer note (the one verification gate):** during the first live Meet, `fly logs` prints the
first raw Recall payload (`first recall payload …`). Confirm its nesting matches the parser's
assumption (`data.data.buffer` / `data.data.type`). If it differs, update
`recall-video-worker/src/recall-events.ts` + its test fixture, `fly deploy` again, and re-test.
Optional later hardening: if 360p is too coarse, check Recall for a higher-resolution `video_separate_png`
option; otherwise accept v1.

---

## Self-review notes

- **Spec coverage:** worker (Tasks 1-5), Recall endpoint config (7), bot-page relay consumer (9), PNG `sendVideoFrame` (6), relay URL plumbing (8), prompt flip (10), Fly deploy + env + E2E (11), graceful audio-only when host unset (7/8 return empty/null), screenshare-only + dedupe (3). All spec sections map to a task.
- **Type consistency:** `parseRecallMessage` → `ParsedRecallEvent` used by `RoomRegistry.handleRecallMessage`; relay envelope `{type:'frame',mime,data,ts}` produced in `rooms.ts` and consumed identically in the bot page (Task 9); `buildMeetingRealtimeEndpoints(botToken)` defined in Task 7 and used there; `videoRelayUrl` added in Task 8 and read in Task 9.
- **Known verification (not a placeholder):** exact Recall payload nesting is confirmed against a real logged payload in Task 11 Step 5, with a concrete fallback action.
