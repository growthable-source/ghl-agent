# Co-Pilot Conversational Blocks — Design

**Date:** 2026-06-18
**Status:** Approved — building

## Context

Co-Pilot agents today have a flat ordered **checklist** (`CopilotAgent.steps` = `string[]`),
and the live runtime is explicitly told *"walk these in order — do not skip, reorder, or
invent steps."* There's no branching: an onboarding agent can't react to "the user can't
share their screen" by going down a different path. This adds **conversational building
blocks** — composable steps that can branch on what happens in the live call — as the
**Advanced** authoring mode for Co-Pilot, mirroring the text-agent Procedural · Advanced
rules already shipped (consistency: [[feedback_copilot_agents_consistency]]).

## The building block

A block is one conversational move plus optional conditional branches:

- **instruction** — plain English: what the agent says/does ("Ask the user if they can
  share their screen").
- **waitForResponse** — when on, the agent pauses for the user's reply before evaluating
  rules. This is the moment the IF conditions fire.
- **rules** — 0–N `IF <condition> THEN <action>`. The **condition** (`when`) is a
  *semantic* predicate the live agent judges from the conversation ("the user cannot share
  their screen") — not a hard variable. The **action** (`then`) is one of (approach **D**):
  - `jump` → go to another block (by id) — real branching.
  - `instruct` → do an inline alternative instruction, then continue to the next block.
  - `end` → wrap up / hand off to a human, ending the flow.
- If no rule matches after a block, fall through to the next block in order.

## Data model (additive — hand-run SQL)

On `CopilotAgent`:
- `procedureMode String @default("simple")` — `"simple" | "advanced"`. Simple = today's
  flat `steps` checklist; Advanced = `blocks`.
- `blocks Json @default("[]")` — array of:
  ```
  { id, label, instruction, waitForResponse: boolean,
    rules: [ { id, when, then: { action: "jump"|"instruct"|"end", targetId?, instruction? } } ] }
  ```
`steps` stays for Simple/legacy. Existing agents → `simple` (default).

## Runtime (`lib/copilot/prompt.ts` `buildAgentPrompt`)

Three shapes, branched in priority:
1. **Advanced (blocks present)** → render a "RUNNING this guided flow" block listing each
   block with its label, instruction, whether to wait, and its rules in plain English
   ("IF the user cannot share their screen → jump to *Verbal walkthrough*"). Instruct the
   model to work blocks top-to-bottom, pause on wait blocks, follow the first matching
   rule (jump / do-inline-then-continue / end), and fall through when none match. The live
   model self-navigates — Co-Pilot is a continuous Gemini Live session, so the flow is
   prompt-described (no per-turn server cursor; same pragmatic choice the live runtime
   already makes for steps). The "don't skip/reorder" non-negotiable is **replaced** with a
   block-flow one: "follow the blocks and their rules; branch exactly as the rules say."
2. **Simple (steps present)** → unchanged existing checklist behavior.
3. **Neither** → unchanged open-ended support.

`lib/copilot/session-service.ts` passes `blocks` + `procedureMode` into the prompt input
(`AgentForPrompt` gains `blocks`). The timebox/maxSecs logic treats a non-empty `blocks`
flow the same as steps.

## API

- Create (`POST …/copilot/agents`) + update (`PATCH …/copilot/agents/[agentId]`): persist
  `procedureMode` (validated to simple|advanced) and `blocks` (validated/normalized array,
  ids assigned server-side if missing, rules clamped to the three actions).

## UI (`copilot/new` + `copilot/agents/[agentId]`)

A **Simple / Advanced** toggle. Simple = today's steps textarea. Advanced = a block
builder: ordered list of blocks, each with a label, instruction textarea, "wait for the
user's reply" toggle, and rule rows (`IF <when text> THEN [jump to <block> | say/do
<instruction> | end call]`). Add/remove/reorder blocks; jump targets are a dropdown of the
other blocks' labels. Theme tokens; `<NewBadge>`. Onboarding template seeds a couple of
example blocks; Support stays reactive (no blocks).

## What this is NOT (YAGNI)

- No visual node canvas — linear block list with jump-to-label (jump expresses branching).
- No nested/parallel blocks, no loops beyond jump.
- No deterministic server-side cursor/tool for the live session — prompt-described
  navigation (Co-Pilot's live model already self-drives the checklist).

## Verification

- Pure unit test: a `buildCopilotBlockFlow(blocks)` helper renders labels, instructions,
  wait markers, and IF/THEN rule lines; empty blocks → ''. Under `lib/**/*.test.ts`.
- `npx tsc --noEmit` + vitest green.
- Manual: create an Onboarding co-pilot with a screen-share block whose rule jumps to a
  "verbal walkthrough" block; confirm the live prompt contains the branch.

## Conventions

Additive migration, hand-run SQL ([[feedback_migration_sql_first]]); no GHL/HighLevel
identifiers; theme tokens; NEW badge; degrade-to-simple when columns absent.
