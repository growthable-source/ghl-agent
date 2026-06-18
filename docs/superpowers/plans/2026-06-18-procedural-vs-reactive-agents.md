# Procedural vs Reactive Agents — Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Make "Reactive (default) vs Procedural" a first-class agent type chosen at creation — reactive agents never get step scaffolding (kills the "step 1 of 3" leak), procedural agents get a real step/progress flow with Simple (written steps) and Advanced (steps + per-answer skip/jump/stop rules) modes.

**Architecture:** A new `Agent.agentKind` discriminator branches prompt construction. Procedural steps live in a new `ProcedureStep` model; per-conversation progress lives on `ConversationStateRecord`. Pure helpers in `lib/agent/procedure.ts` build the prompt block and evaluate rules (TDD). A tool lets the agent advance steps deterministically. UI: a wizard fork + a procedure-builder sub-page.

**Tech Stack:** Next.js 16, Prisma 7 (Postgres, additive hand-run SQL), React 19, Vitest.

**Degrade rule:** every read of the new columns/model is wrapped so that pre-migration (columns absent → Prisma P2022) the agent behaves as **reactive** — which is the safe default and already fixes the leak.

---

### Task 1: Schema — agentKind, procedureMode, ProcedureStep, progress columns

**Files:** Modify `prisma/schema.prisma`; Create `prisma/migrations/20260618160000_procedural_agents/migration.sql`

- [ ] **Step 1:** In `model Agent`, after `qualifyingStyle` (line ~611) add:
```prisma
  // Behavioral type chosen at creation. "reactive" (default) = diagnose +
  // resolve, no steps. "procedural" = walk a defined sequence with progress.
  agentKind     String @default("reactive") // "reactive" | "procedural"
  // Only meaningful when agentKind="procedural".
  procedureMode String @default("simple")   // "simple" | "advanced"
```
Add to Agent's relation list: `procedureSteps ProcedureStep[]`

- [ ] **Step 2:** Add new model near `model ConversationStateRecord`:
```prisma
model ProcedureStep {
  id              String  @id @default(cuid())
  agentId         String
  agent           Agent   @relation(fields: [agentId], references: [id], onDelete: Cascade)
  order           Int
  title           String
  instruction     String  @db.Text
  // Advanced-mode only:
  question        String?
  collectFieldKey String?
  rules           Json    @default("[]") // [{ when, action: "skip"|"jump"|"stop", target? }]
  createdAt       DateTime @default(now())
  @@index([agentId, order])
}
```

- [ ] **Step 3:** In `model ConversationStateRecord` add:
```prisma
  procedureStepOrder Int?
  procedureDoneAt    DateTime?
```

- [ ] **Step 4:** Write `migration.sql` (additive, idempotent):
```sql
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "agentKind" TEXT NOT NULL DEFAULT 'reactive';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "procedureMode" TEXT NOT NULL DEFAULT 'simple';
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "procedureStepOrder" INTEGER;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "procedureDoneAt" TIMESTAMP(3);
CREATE TABLE IF NOT EXISTS "ProcedureStep" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "order" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "instruction" TEXT NOT NULL,
  "question" TEXT,
  "collectFieldKey" TEXT,
  "rules" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcedureStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureStep_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProcedureStep_agentId_order_idx" ON "ProcedureStep"("agentId","order");
```

- [ ] **Step 5:** Run `npx prisma format && npx prisma generate`. Expected: valid, client generated.
- [ ] **Step 6:** Commit `feat(agents): schema for procedural/reactive types + procedure steps`.

---

### Task 2: Pure helpers — procedure prompt block + rule evaluation (TDD)

**Files:** Create `lib/agent/procedure.ts`, `lib/agent/procedure.test.ts`

- [ ] **Step 1:** Write `lib/agent/procedure.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { buildProcedureBlock, evaluateStepRules, type ProcStep } from './procedure'

const steps: ProcStep[] = [
  { id: 's1', order: 0, title: 'Greet', instruction: 'Welcome them', question: null, collectFieldKey: null, rules: [] },
  { id: 's2', order: 1, title: 'Plan', instruction: 'Ask their plan', question: 'Which plan?', collectFieldKey: null, rules: [{ when: 'enterprise', action: 'jump', target: 's4' }] },
  { id: 's3', order: 2, title: 'Card', instruction: 'Collect card', question: null, collectFieldKey: null, rules: [] },
  { id: 's4', order: 3, title: 'Done', instruction: 'Confirm', question: null, collectFieldKey: null, rules: [] },
]

describe('buildProcedureBlock', () => {
  it('states current step and progress for procedural', () => {
    const b = buildProcedureBlock(steps, 1, 'advanced')
    expect(b).toContain('Step 2 of 4')
    expect(b).toContain('Plan')
    expect(b).toContain('Which plan?')
  })
  it('returns empty string when there are no steps', () => {
    expect(buildProcedureBlock([], 0, 'simple')).toBe('')
  })
})

describe('evaluateStepRules', () => {
  it('jumps to target step on matching answer', () => {
    expect(evaluateStepRules(steps[1], 'we want enterprise')).toEqual({ action: 'jump', target: 's4' })
  })
  it('returns advance (next) when no rule matches', () => {
    expect(evaluateStepRules(steps[1], 'starter please')).toEqual({ action: 'advance' })
  })
  it('returns advance for a step with no rules', () => {
    expect(evaluateStepRules(steps[0], 'hi')).toEqual({ action: 'advance' })
  })
})
```

- [ ] **Step 2:** Run `npx vitest run lib/agent/procedure.test.ts` — expect FAIL (module not found).

- [ ] **Step 3:** Implement `lib/agent/procedure.ts`:
```ts
export interface ProcRule { when: string; action: 'skip' | 'jump' | 'stop'; target?: string }
export interface ProcStep {
  id: string; order: number; title: string; instruction: string
  question: string | null; collectFieldKey: string | null; rules: ProcRule[]
}
export type StepOutcome = { action: 'advance' } | { action: 'jump'; target?: string } | { action: 'skip' } | { action: 'stop' }

/** Build the procedural system-prompt block. Empty when no steps. */
export function buildProcedureBlock(steps: ProcStep[], currentOrder: number, mode: 'simple' | 'advanced'): string {
  if (!steps.length) return ''
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  const total = ordered.length
  const idx = Math.max(0, Math.min(currentOrder, total - 1))
  const cur = ordered[idx]
  const list = ordered.map((s, i) => `${i + 1}. ${s.title}${i === idx ? '  ← CURRENT' : ''}`).join('\n')
  let block = `\n\n## Procedure — follow these steps in order\n\nYou are running a guided procedure. You are on **Step ${idx + 1} of ${total}**. Announce progress naturally ("step ${idx + 1} of ${total}"). Only move to the next step once the current step's goal is met. When the final step completes, call \`advance_procedure_step\` with done=true.\n\n${list}\n\n### Current step: ${cur.title}\n${cur.instruction}`
  if (cur.question) block += `\nAsk: "${cur.question}"`
  if (mode === 'advanced' && cur.rules.length) {
    const r = cur.rules.map(x => `- If the answer indicates "${x.when}" → ${x.action}${x.target ? ` to the step titled appropriately` : ''}`).join('\n')
    block += `\n\nRules for this step's answer:\n${r}\nCall \`advance_procedure_step\` with the matching outcome (skip / jump / stop / next).`
  }
  return block
}

/** Decide what happens after the current step given the visitor's answer. */
export function evaluateStepRules(step: ProcStep, answer: string): StepOutcome {
  const a = (answer || '').toLowerCase()
  for (const rule of step.rules ?? []) {
    if (rule.when && a.includes(rule.when.toLowerCase())) {
      if (rule.action === 'jump') return { action: 'jump', target: rule.target }
      if (rule.action === 'skip') return { action: 'skip' }
      if (rule.action === 'stop') return { action: 'stop' }
    }
  }
  return { action: 'advance' }
}
```

- [ ] **Step 4:** Run `npx vitest run lib/agent/procedure.test.ts` — expect PASS.
- [ ] **Step 5:** Commit `feat(agents): procedure prompt-block + rule-eval helpers (TDD)`.

---

### Task 3: Prompt wiring — branch on agentKind

**Files:** Modify `lib/ai-agent.ts` (~249-290, ~798-815), `lib/agent/build-prompt.ts` (~27, ~175)

- [ ] **Step 1:** In `lib/ai-agent.ts`, load the agent's `agentKind`/`procedureMode` where the agent row is fetched (the run already loads agent config; add the two fields to that select). Compute:
```ts
const isProcedural = (agentRow?.agentKind ?? 'reactive') === 'procedural'
```
(Wrap the field access so a missing column → treat as reactive.)

- [ ] **Step 2:** Replace the qualifying-block assembly (lines ~277-285) so it only runs for **non-procedural? No** — gate by kind:
```ts
let qualifyingBlock = ''
let procedureBlock = ''
if (isProcedural) {
  const { db } = await import('./db')
  let steps: any[] = []
  try {
    steps = await db.procedureStep.findMany({ where: { agentId }, orderBy: { order: 'asc' } })
  } catch (e: any) { if (e?.code !== 'P2021' && e?.code !== 'P2022') throw e }
  let curOrder = 0
  try {
    const st = await db.conversationStateRecord.findUnique({ where: { agentId_contactId: { agentId, contactId } }, select: { procedureStepOrder: true } })
    curOrder = st?.procedureStepOrder ?? 0
  } catch { /* pre-migration */ }
  const { buildProcedureBlock } = await import('./agent/procedure')
  procedureBlock = buildProcedureBlock(steps as any, curOrder, (agentRow?.procedureMode ?? 'simple'))
} else {
  // REACTIVE: no step/strict scaffolding at all — this removes the "step 1 of 3" leak.
  // (qualifyingBlock stays empty for reactive agents.)
}
```
Delete/skip the old strict qualifying block for reactive (leave qualifying questions available only via procedural-simple authoring; reactive gets none).

- [ ] **Step 3:** In `lib/agent/build-prompt.ts`: add `procedureBlock?: string` to `SystemPromptOptions` (near line 27), destructure it (~line 69), and after the qualifyingBlock concat (~175) add:
```ts
  if (procedureBlock) prompt += procedureBlock
```

- [ ] **Step 4:** In `lib/ai-agent.ts` ~805, pass `procedureBlock,` into the `buildSystemPromptParts` options.

- [ ] **Step 5:** `npx tsc --noEmit` — expect clean.
- [ ] **Step 6:** Commit `feat(agents): branch prompt on agentKind — reactive drops step scaffolding`.

---

### Task 4: `advance_procedure_step` tool — deterministic progress

**Files:** Modify `lib/agent/tool-catalog.ts` (register tool, procedural-only), `lib/agent/execute-tool.ts` (handler)

- [ ] **Step 1:** Register tool `advance_procedure_step` with input `{ outcome: "next"|"skip"|"jump"|"stop", targetStepTitle?: string, done?: boolean }`, only included when the agent is procedural.

- [ ] **Step 2:** Add handler in `execute-tool.ts` switch:
```ts
case 'advance_procedure_step': {
  if (!agentId) return JSON.stringify({ success: true })
  const { db } = await import('../db')
  const steps = await db.procedureStep.findMany({ where: { agentId }, orderBy: { order: 'asc' } }).catch(() => [])
  const cur = (await db.conversationStateRecord.findUnique({ where: { agentId_contactId: { agentId, contactId: contactId as string } }, select: { procedureStepOrder: true } }).catch(() => null))?.procedureStepOrder ?? 0
  let next = cur + 1
  if (input.outcome === 'skip') next = cur + 1
  else if (input.outcome === 'jump' && input.targetStepTitle) {
    const t = steps.findIndex((s: any) => s.title === input.targetStepTitle)
    if (t >= 0) next = t
  }
  const done = !!input.done || input.outcome === 'stop' || next >= steps.length
  await db.conversationStateRecord.update({
    where: { agentId_contactId: { agentId, contactId: contactId as string } },
    data: { procedureStepOrder: Math.min(next, Math.max(0, steps.length - 1)), ...(done ? { procedureDoneAt: new Date() } : {}) },
  }).catch(() => {})
  return JSON.stringify({ success: true, step: next, done })
}
```
(Wrap all DB calls so pre-migration degrades to no-op.)

- [ ] **Step 3:** `npx tsc --noEmit` — clean. Commit `feat(agents): advance_procedure_step tool for deterministic progress`.

---

### Task 5: Procedure CRUD API

**Files:** Create `app/api/workspaces/[workspaceId]/agents/[agentId]/procedure/route.ts` (GET list, PUT replace-all), and `…/procedure/[stepId]/route.ts` is unnecessary — use PUT replace-all for simplicity.

- [ ] **Step 1:** `GET` → `{ steps }` ordered; `PUT` body `{ steps: [{title,instruction,question?,collectFieldKey?,rules?}] }` → transaction: delete existing for agent, recreate with `order` = index. Gate `requireWorkspaceAccess`. Wrap in P2021/P2022 degrade returning `{ steps: [], migrationPending: true }`.
- [ ] **Step 2:** `npx tsc --noEmit` — clean. Commit `feat(agents): procedure steps CRUD API`.

---

### Task 6: Wizard fork + procedure builder UI + nav

**Files:** Modify `app/dashboard/[workspaceId]/agents/new/wizard/page.tsx` (add Reactive/Procedural first choice → sets agentKind on create), `…/agents/wizard/create/route.ts` (persist agentKind/procedureMode), `app/dashboard/[workspaceId]/agents/[agentId]/layout.tsx` (add "Procedure" tab, shown for procedural agents), Create `app/dashboard/[workspaceId]/agents/[agentId]/procedure/page.tsx`

- [ ] **Step 1:** Wizard: add a first step "What kind of agent?" with two cards — **Reactive** ("Answers questions & resolves issues — support, FAQ, triage") and **Procedural** ("Walks the user through a defined sequence — onboarding, intake, booking"). Procedural reveals Simple/Advanced toggle. Pass `agentKind`/`procedureMode` to the create call.
- [ ] **Step 2:** `create/route.ts`: persist `agentKind`, `procedureMode` on `db.agent.create`.
- [ ] **Step 3:** `layout.tsx`: add tab `{ key: 'procedure', label: 'Procedure', path: '/procedure' }` to the relevant hub; render only when the loaded agent's `agentKind === 'procedural'`. Add `<NewBadge since="2026-06-18">`.
- [ ] **Step 4:** `procedure/page.tsx`: ordered step list (title + instruction), add/remove/reorder; when `procedureMode==='advanced'`, each step shows a question field, "save answer to field" select, and rule rows (`when answer contains … → skip / jump to <step> / stop`). Loads/saves via the Task 5 API. Theme tokens only.
- [ ] **Step 5:** `npx tsc --noEmit` + `npx eslint` the new/changed files — clean (any-style consistent with codebase).
- [ ] **Step 6:** Commit `feat(agents): wizard type fork + procedure builder UI`.

---

### Task 7: Verify + ship

- [ ] **Step 1:** `rm -rf .next && npx tsc --noEmit` — clean.
- [ ] **Step 2:** `npx vitest run` — all green (incl. new procedure tests).
- [ ] **Step 3:** Preview: load the new wizard step + a procedural agent's `/procedure` page; confirm render + no console errors (best-effort; authed pages may not fully exercise).
- [ ] **Step 4:** Push to `main` (production). Provide the additive migration SQL for Ryan to hand-run; note the app degrades to reactive until it's applied.
- [ ] **Step 5:** Update memory `project_*` + MEMORY.md with the shipped feature + pending SQL.

---

## Self-review notes
- Spec coverage: agentKind/procedureMode (T1), ProcedureStep (T1), progress on ConversationStateRecord (T1), prompt branch + reactive leak removal (T3), procedure block + rules (T2), advance tool (T4), wizard fork + builder (T6), migration + degrade (T1/T7), tests (T2/T7). ✓
- Reactive default + existing-agents-reactive: achieved by column default `'reactive'` (T1) and degrade-to-reactive on missing column (T3). ✓
- Rule vocabulary skip/jump/stop consistent across T2/T4/T6. ✓
