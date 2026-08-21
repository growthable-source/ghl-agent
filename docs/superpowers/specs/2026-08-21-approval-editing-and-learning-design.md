# Approval-queue editing, diff feedback, activity history & agent learning

**Date:** 2026-08-21
**Branch:** `feat/approval-editing-and-learning`
**Status:** approved (design)

## Problem

The portal approval queue lets a brand's reviewer only **Approve-&-send** or
**Reject-with-note** a support reply drafted by the team/AI. The reviewer
can't edit the wording; the author never learns what changed; the decision
leaves no trace on the ticket; and nothing that happens in the queue improves
future replies.

## Goals

1. **Editable reply.** The reviewer can edit the proposed reply before
   approving. The edited text is what gets sent.
2. **Feedback to the author.** The reply's author (the person who drafted &
   submitted it) is told the outcome — *approved*, *approved with changes*
   (with a diff), or *rejected with reason*.
3. **Activity history.** Every decision (with reason/diff) appears in the
   ticket's activity feed on the dashboard.
4. **The brand agent learns.** An approved resolution becomes brand-scoped
   knowledge that the brand's agent retrieves — improving both the live-chat
   widget and the next *suggested ticket reply* — gated by human review.

## Non-goals (same rails, later)

- Capturing positive/negative **ticket ratings** as a training signal. The
  learning intake is built so a rating signal can feed it later, but no
  rating-capture UI ships here.

## Architecture context (Growthable)

- **Universal Knowledge** = unbranded GHL corpus, shared via `isGlobal`
  collections.
- **Brand-Only Knowledge** = per-brand `KnowledgeDomain`/`KnowledgeCollection`
  (`getOrCreateBrandDomain` / `getOrCreateBrandCollection`), layered on top of
  universal. Holds the brand's help-center articles **and** distilled
  interactions from ticketing + live chat.
- The brand agent both **reads** Brand-Only Knowledge (widget chat via
  `retrieveAndFormatForAgent`; ticket `suggest-reply` via
  `buildTicketReplyContext`) and, with this feature, **writes back** into it.

### The load-bearing retrieval fact

`suggest-reply` (`lib/tickets/reply-context.ts`) retrieves **only** pgvector
`KnowledgeChunk`s over the brand domain — it never reads `KnowledgeEntry`
rows. The widget chat reads **both** (prompt-stuffed entries + RAG chunks).

Therefore a learning stored as a `KnowledgeEntry` (what the existing
`MinedQaPair → save-as-knowledge` path creates) would reach the widget chat
but **never** improve the next suggested ticket reply. To satisfy goal 4, an
approved learning **must become an embedded `KnowledgeChunk` in the brand
domain.**

## Design

### 1. Editable reply + diff — data model

`TicketReplyDraft`:
- `body` stays the **immutable submitted proposal**.
- add `editedBody String? @db.Text` — the reviewer's edited version, `null`
  when untouched. Sent text = `editedBody ?? body`.
- "approved **with changes**" is *derived*
  (`status==='approved' && editedBody && editedBody!==body`) — no new status
  value, so existing queries are untouched.

Portal UI (`PortalApprovalsClient.tsx`): the read-only "Proposed reply" panel
becomes a textarea pre-filled with `body`, with a live "edited" indicator and
a collapsible before→after diff. `POST /api/portal/approvals/[draftId]` gains
an optional `body`; on approve it stores `editedBody` when changed and sends
the edited text through the existing Resend path.

### 2. Feedback to the author

After the decision, a **personal** notification
(`notify({ event: 'ticket.approval_decided', targetUserId: submittedByUserId })`,
which skips shared channels and delivers to the author's own email/web-push):
- approved clean → "Reply for #N approved & sent."
- approved with changes → "Approved with edits — see what changed" (links to
  the ticket note in §3).
- rejected → "Rejected: <reason>."

Guarded when `submittedByUserId` is null (admin-preview / deleted user). New
event registered in `lib/notification-events.ts` (`defaultUserChannels:
['email','web_push']`) — an unregistered event delivers nothing.

### 3. Activity history in the ticket feed

Each decision writes a `TicketMessage(direction:'internal_note')` — team-only,
never emailed — onto the ticket, which is the dashboard "activity feed":
- approved → "✅ Reply approved & sent by \<reviewer\>."
- approved with changes → "✅ Approved with changes by \<reviewer\>." + the
  unified diff in the note body.
- rejected → "⛔ Reply rejected by \<reviewer\>: \<reason\>."

Attribution uses `fromEmail`/`fromName` + `sentByPortalUserId` (the portal
reviewer), matching the existing portal internal-note pattern.

### 4. Brand-agent learning — human-gated, embedded as a chunk

Reuses the existing review-queue surface so ticketing and live-chat mining
feed **one** brand-knowledge queue (the collection page's "Mined Q&A" tab).

**On approve-&-send** — stage a learning candidate:
- Distill the exchange (last inbound question + the sent reply) into a clean,
  PII-stripped `Q → A` via the cheap mining model. On any failure, fall back
  to a raw pair (question = inbound, answer = sent reply) so nothing is lost.
- Persist as a `MinedQaPair` on the **brand collection**
  (`getOrCreateBrandCollection(brandId)`), with `source='ticket_approval'`,
  `sourceTicketId`, `confidence`.
- Best-effort and fully guarded — a staging failure never breaks the approval
  or the email send.

Schema (`MinedQaPair`): `runId` → nullable; add `source String
@default('mining')`, `sourceTicketId String?`, `knowledgeSourceId String?`.

**On promote** (operator approves the pair in the Mined Q&A tab) — for
`source='ticket_approval'` pairs, embed into the brand domain as a chunk
instead of creating a `KnowledgeEntry`:
- create a `KnowledgeSource(sourceType:'qa')` in the brand's `KnowledgeDomain`
  (also tagged with the brand `collectionId`) whose `crawlConfig` carries the
  `Q → A` markdown, then a queued `IngestionRun`.
- the existing ingest-queue cron runs `ingestSource` → chunk → classify →
  embed → `KnowledgeChunk` in the brand domain.
- both the widget chat and `suggest-reply` do pgvector retrieval over the
  brand domain, so the learning reaches **both**.

Existing mining-sourced pairs keep their `KnowledgeEntry` behavior unchanged
(scoped blast radius).

### New ingest adapter — inline text

The pipeline routes on `sourceType` and has no inline-text adapter. Add
`lib/ingest/adapters/qa.ts` (`sourceType:'qa'`): `discover` returns the
source's own identifier; `fetch` returns the text stashed in `crawlConfig`;
`normalize` passes it through as markdown. Register in
`lib/ingest/pipeline.ts` `ADAPTERS`. Identifier is a non-URL synthetic
(`ticket-resolution:<draftId>`), which the pipeline's URL-keyed skip logic
handles safely (returns '' → no false skip).

## New/changed units (each testable in isolation)

- `lib/tickets/reply-diff.ts` — pure `computeReplyDiff(original, edited)` →
  `{ changed, unified }`. **Unit-tested.**
- `lib/tickets/resolution-to-qa.ts` — `buildResolutionQaPrompt` +
  `parseResolutionQa` (pure, **unit-tested**) + `distillResolutionToQa` (thin
  LLM call).
- `lib/tickets/brand-knowledge.ts` — `stageTicketResolutionLearning(...)` and
  `embedQaIntoBrandKnowledge(...)` (the seam ratings plug into later).
- `lib/ingest/adapters/qa.ts` — inline-text adapter.
- Routes/UI: portal `[draftId]` route, `PortalApprovalsClient.tsx`,
  mined-pairs PATCH route, Mined Q&A tab provenance badge.

## Testing

Per `CLAUDE.md`, `vitest` covers `lib/**` pure helpers only. Unit tests for
`reply-diff` and the pure parts of `resolution-to-qa`. Route/DB/LLM/ingest
wiring is outside the unit harness — verified by reading + a typecheck/lint
pass.

## Migration & rollout safety

- New columns are nullable / defaulted → additive, no backfill.
- Every new read is wrapped for pre-migration DBs (P2022/P2021 swallow), same
  as the surrounding code.
- Learning is human-gated: nothing reaches an agent without an operator
  approving the staged pair.
