# Procedural vs Reactive Agents — Design

**Date:** 2026-06-18
**Status:** Design (awaiting review)

## Context — why this change

Today every agent inherits a procedural, step-marching frame by default:
`Agent.qualifyingStyle` defaults to `"strict"`, whose injected prompt block says
*"work through every question below IN ORDER… then ask the next question. Do not
skip ahead,"* and `Agent.toolAutonomyMode` defaults to `"guided"`. That's correct
for a guided onboarding or form-fill, but **wrong for a support conversation** —
which has no steps. The observed symptom: support agents narrate "I've done step
1 of 3" when no such sequence exists. There is no first-class concept that says
"this agent is a *procedure runner*" vs "this agent is a *reactive diagnoser*";
the procedural behavior is just the unlabelled default, applied everywhere.

This introduces that distinction as the primary choice when creating an agent.

## The two types (chosen at agent creation)

- **Reactive** *(default)* — no sequence, no progress counter. Ingests the
  visitor's messages, diagnoses, references Knowledge, and resolves. Natural
  conversational style, autonomous tool use. This is what the existing reactive
  Visual Workflow Canvas (`channelTrigger → routingRule → tool → stopCondition →
  endpoints`) and Knowledge retrieval already serve — we simply **stop injecting
  any step/strict scaffolding** into it. A reactive agent has no step counter, so
  it cannot leak one.

- **Procedural** — the agent tracks real progress through a defined sequence and
  has a terminal "done." It is the **only** type that ever says "step 2 of 3,"
  because it is the only type that has steps. Used for guided onboarding,
  form-fill / intake, booking, any "walk the user through X" flow.

Procedural has two authoring modes (reusing the SIMPLE/ADVANCED vocabulary that
already exists conceptually in the schema):

- **Procedural · Simple** — an ordered list of plain written steps. The agent
  works them in order and tracks which step it is on.
- **Procedural · Advanced** — each step may ask a question and carries **rules on
  the answer**: `skip` (skip this step), `jump` (go to step N — this is how
  branching is expressed), or `stop` (end / hand off to a human). A linear
  procedure with conditional escapes. Authored as an
  ordered step list with inline per-step rule rows — **not** the React Flow
  canvas (procedures are linear; a list is clearer and far less build than
  bending the reactive, trigger-shaped canvas).

## Data model (additive — hand-run SQL per migration policy)

- `Agent.agentKind String @default("reactive")` — `"reactive" | "procedural"`.
  New behavioral discriminator. Orthogonal to the legacy `agentType`
  (SIMPLE/ADVANCED, config-complexity) and `viewMode` — those stay as-is.
- `Agent.procedureMode String @default("simple")` — `"simple" | "advanced"`,
  only meaningful when `agentKind = "procedural"`.
- New model **`ProcedureStep`**:
  - `id`, `agentId` (→ Agent, cascade), `order Int`, `title String`,
    `instruction String @db.Text` (what the agent does/says this step).
  - Advanced-only fields: `question String?` (the prompt to the visitor),
    `collectFieldKey String?` (optional CRM/contact field to write the answer to),
    `rules Json @default("[]")` — array of `{ when: <answer condition>, action:
    "skip" | "jump" | "stop", target?: <stepId for jump> }`.
  - `@@index([agentId, order])`.
- **Progress state**: extend the existing per-conversation
  `ConversationStateRecord` (keyed `agentId_contactId`) with
  `procedureStepOrder Int?` and `procedureDoneAt DateTime?`. Reactive agents never
  write these, so there is no counter to surface.

## Prompt construction

`lib/ai-agent.ts` / `lib/agent/build-prompt.ts` branch on `agentKind`:

- **Reactive**: build the prompt with **no** qualifying/strict/step block.
  Knowledge-retrieval block + persona + tools, framed as "diagnose and resolve."
  `qualifyingStyle` becomes inert for reactive agents.
- **Procedural**: build a new **procedure block** that lists the steps, states the
  **current** step and progress ("Step 2 of 3"), and instructs the agent to
  advance only when the current step's goal is met. In Advanced mode it also
  states the per-step answer rules so the model can skip/jump/stop. The
  runtime persists `procedureStepOrder` as the agent advances, and marks
  `procedureDoneAt` at the terminal step.

The existing strict qualifying-questions block is **subsumed** by procedural
Simple mode (ordered intake = the canonical "simple procedure"); qualifying
questions remain available but no longer drive step-narration on reactive agents.

## UI

- **Agent creation wizard** (`app/dashboard/[workspaceId]/agents/new/wizard/`):
  the first choice becomes **Reactive vs Procedural**, with one-line descriptions.
  Procedural reveals a Simple/Advanced toggle. Only the relevant config surfaces
  show thereafter.
- **Procedure builder** (new sub-page under the agent detail, e.g.
  `…/agents/[agentId]/procedure/`): ordered step list, drag to reorder, add/edit
  step (title + instruction). Advanced mode adds, per step, a question field, an
  optional "save answer to field," and rule rows (`when answer … → skip / jump to
  step / stop`). Theme tokens only; `<NewBadge since="…">` on the menu
  entry.
- Reactive agents keep the existing canvas + knowledge config unchanged.

## Migration of existing agents

- Backfill **all existing agents to `reactive`** — the safe, leak-free default
  that immediately fixes the reported symptom for everyone.
- Owners explicitly opt an agent into Procedural and author its steps. (Optional
  heuristic, deferred: agents that have ordered required qualifying questions
  could be *suggested* as procedural-simple, but not auto-converted.)

## What this is NOT (YAGNI)

- No visual node canvas for procedures — linear step list only.
- No nested/sub-procedures, no parallel steps, no loops beyond `jump`.
- Reactive type gets no new config — it is the existing behavior minus the
  step scaffolding.

## Verification

- Unit: prompt builder emits a step/progress block for procedural and **none**
  for reactive (guards the regression). Rule evaluation (skip/jump/stop)
  as pure-function tests under `lib/**/*.test.ts`.
- Manual: create one reactive support agent (confirm it never narrates steps) and
  one procedural onboarding agent (confirm "step N of M" tracks correctly,
  advances on completion, and an Advanced rule skips/stops as configured).
- `npx tsc --noEmit` + existing vitest suite green.

## Conventions honored

Additive migration, Ryan hand-runs SQL ([[feedback_migration_sql_first]]); no
"GHL"/"HighLevel" identifiers; theme tokens not raw palette; NEW badge on the new
menu entry; brand-neutral copy.
