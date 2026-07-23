# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ Next.js version

@AGENTS.md

This is **Next.js 16 + React 19** (App Router). APIs and conventions differ from older versions you may know. Before writing routing/rendering/caching code, read the relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.

## Commands

```bash
npm run dev              # local dev server (localhost:3000)
npm run build            # next build (does NOT run migrations)
npm run db:migrate:deploy  # scripts/prisma-migrate.mjs — the deploy-time migration wrapper
npm run lint             # eslint (eslint-config-next)
npm test                 # vitest run — unit tests only
npm run test:watch       # vitest watch
npx vitest run lib/foo.test.ts          # single test file
npx vitest run -t "name of test"        # single test by name

npm run db:migrate -- --name describe_change   # create + apply a migration locally
npm run db:studio        # prisma studio
```

**Testing scope.** `vitest.config.ts` only picks up `lib/**/*.test.ts` — pure helpers, no Prisma/Anthropic. Tests are colocated next to the code (`lib/foo.ts` → `lib/foo.test.ts`). Anything touching the DB or the LLM is intentionally excluded from the unit harness.

**Migrations.** Prisma managed migrations under `prisma/migrations/`, applied at deploy time via `npm run db:migrate:deploy` (`scripts/prisma-migrate.mjs` — read its header: baseline bootstrap, skip-if-already-applied, fail-open env vars). Never edit a committed migration (checksum mismatch fails the next deploy) — add a new one. See `prisma/MIGRATIONS.md` for bootstrap behavior and legacy flat-file history.

## What this is

A multi-tenant SaaS that builds and runs **AI conversational agents** for businesses. It primarily ships as an embedded app inside the LeadConnector / GoHighLevel (GHL) marketplace (running on thousands of whitelabel agency domains), but also works standalone. An agent answers leads across channels (web chat widget, SMS/Twilio, Meta Messenger/Instagram, voice), pulls from a per-agent knowledge base, calls CRM/commerce tools, qualifies leads, books appointments, and hands off to humans.

The codebase is large (`lib/` ≈ 170 files, Prisma schema ≈ 130 models). The notes below are the load-bearing structure — read them before assuming where something lives.

## Architecture

### The agent runtime (the core loop)
- [lib/ai-agent.ts](lib/ai-agent.ts) — `runAgent()` is the heart: assembles runtime context blocks, drives the agentic tool loop against the Anthropic Messages API, returns an `AgentResponse`. The pure pieces live in [lib/agent/](lib/agent/): `build-prompt.ts` / `build-base-prompt.ts` (system prompt assembly), `tool-catalog.ts` (`AGENT_TOOLS`), `execute-tool.ts` (the CRM/commerce tool dispatcher), `tool-config.ts` + `tool-gate.ts` (per-agent enable/gating), `sandbox.ts` (playground stubs).
- **Many entry points call `runAgent`**, all converging on the same loop: web widget ([lib/widget-agent-runner.ts](lib/widget-agent-runner.ts)), native channels — Twilio + Meta — ([lib/channel-inbound.ts](lib/channel-inbound.ts)), GHL webhooks, playground, replay, triggers, simulator. When changing agent behavior, change it in the shared runtime, not per-channel.
- **Channel pipeline split.** `channel-inbound.ts` separates `runChannelInbound` (decide + run agent) from `finalizeChannelInbound` (channel-specific send + persist + bill), so each channel owns its send semantics.

### Voice (Vapi) — a separate runtime
Voice does **not** go through `runAgent`. Vapi hosts the conversation loop; our job is config + tool serving:
- [lib/voice/vapi-assistant.ts](lib/voice/vapi-assistant.ts) is the **single source of truth** for assistant config — ALL four call paths (browser test, widget, inbound phone, outbound phone) reference the registered assistant by id. Never rebuild config inline per call; that drift was a real bug class (the legacy per-call builder `buildVoiceSystemPrompt` is deleted).
- **Per-call context** travels via `assistantOverrides.variableValues` — the registered prompt has a `{{callContext}}` template slot Vapi substitutes at call start. Every entry point must pass `callContext` (+ `workspaceId`, `agentId`, `direction`).
- [lib/voice-prompt.ts](lib/voice-prompt.ts) defines `VAPI_TOOLS` (e.g. `query_knowledge` — per-turn vector retrieval instead of baking knowledge into the static prompt). `app/api/vapi/webhook/` serves tool-calls events, **requires the `x-vapi-secret` header when `VAPI_WEBHOOK_SECRET` is set**, and owns minute accounting (finalize-once on the CallLog keyed by `vapiCallId` — don't add usage tracking elsewhere).
- **Re-sync discipline:** the registered assistant bakes the prompt at sync time. The agent PATCH route and the Voice-tab PUT both call `syncVapiAssistant`; if you add another surface that edits prompt-relevant agent fields, it must re-sync too.
- [lib/vapi-client.ts](lib/vapi-client.ts) wraps the Vapi API with typed `VapiError`s (`PHONE_NUMBER_ACTIVATING`, `CONCURRENCY_BLOCKED`, …) — branch on `.code`, don't parse strings.
- Voice-safe tool gating rides the existing `tool-config` presets (the `voice` preset); per-workspace minute quotas in `lib/voice-quota.ts` (all four paths are gated AND metered); wizard templates in `lib/voice/templates.ts`.

### Provider abstractions (factory + adapter)
Two pluggable backends, both resolved by a factory that returns a provider-specific adapter behind a common interface:
- **CRM** — [lib/crm/factory.ts](lib/crm/factory.ts) → `getCrmAdapter(locationId)`. Providers: `ghl`, `hubspot`, `native` (our own DB-backed CRM), `none` (placeholder). The `locationId` is overloaded: `placeholder:*` and `native:<workspaceId>` short-circuit without a DB hit; real GHL ids hit `Location.crmProvider`. Interface in [lib/crm/types.ts](lib/crm/types.ts).
- **Commerce** — [lib/commerce/factory.ts](lib/commerce/factory.ts) → `getCommerceAdapter(workspaceId)`, returns a `ShopifyAdapter` or `null` (treat null as "not wired up", don't throw).

### Knowledge / RAG
[lib/ingest/](lib/ingest/) is the pipeline (adapters → chunker → classify → embed → retrieve), [lib/rag.ts](lib/rag.ts) and [lib/agent/retrieve-for-agent.ts](lib/agent/retrieve-for-agent.ts) feed retrieved chunks into the prompt. Knowledge is scoped per collection/agent (`KnowledgeCollection`, `AgentCollection`, `KnowledgeChunk`, etc.).

### Auth & tenancy
- [lib/auth.ts](lib/auth.ts) — NextAuth v5 (database sessions, Google/GitHub). Every server component / action / route calls `auth()`.
- **Tenancy is workspace-scoped.** A `Workspace` has `Location`s (CRM bindings) and `Agent`s. Access guards: `lib/require-workspace-access.ts`, `require-workspace-role.ts`, `require-access.ts`. Use these — don't hand-roll membership checks.
- [middleware.ts](middleware.ts) does two things: gate `/dashboard/*` on a session, and **promote the embed-session cookie** onto the regular NextAuth cookie name so `auth()` resolves inside the marketplace iframe. The matcher also covers workspace-scoped API routes (which still do their own per-route auth).
- **Iframe embedding** ([next.config.ts](next.config.ts)): `frame-ancestors *` is deliberate (thousands of whitelabel domains). Security rests on the signed SSO handshake (`/api/auth/leadconnector-iframe-handshake`), not the parent origin. See `lib/embedded-context.tsx`, `lib/leadconnector-sso.ts`, `lib/embed-session.ts`.
- **Other auth realms:** customer-facing **portal** (`lib/portal-auth.ts`), **widget** visitors (`lib/widget-auth.ts`), **admin** (`lib/admin-auth.ts` + 2FA), each with their own session mechanism.

### Routes
- `app/api/` is split by surface: `webhooks/`, `inbound/`, `twilio/`, `meta/`, `vapi/` + `voice/` (Vapi voice agents), `widget/`, `workspaces/`, `integrations/`, `admin/`, `portal/`, `public/`, `cron/`.
- `app/dashboard/[workspaceId]/` is the operator UI. `agents/[agentId]/*` is the per-agent config surface (persona, prompt, tools, knowledge, routing, follow-ups, voice, evaluations, experiments, deploy, …).
- **Cron jobs** are HTTP routes under `app/api/cron/*`, scheduled in [vercel.json](vercel.json) (follow-ups, token refresh, recrawl, native outbox, stale conversations, etc.).

### Conventions
- Import alias `@/*` → repo root (e.g. `@/lib/db`, `@/types`).
- `db` is the shared Prisma singleton — always `import { db } from '@/lib/db'`, never `new PrismaClient()`.
- At-rest secrets (MCP tokens, etc.) go through [lib/secrets.ts](lib/secrets.ts) (AES-256-GCM, `SECRETS_ENCRYPTION_KEY`).
- Existing files carry long, deliberate header comments explaining *why*. Read them; match that density when editing.

### Environment
See [.env.local.example](.env.local.example). Notable required vars: `ANTHROPIC_API_KEY`, `DATABASE_URL` (+ `DIRECT_URL`), `OAUTH_CLIENT_ID/SECRET` (LeadConnector marketplace), `SECRETS_ENCRYPTION_KEY`, plus per-integration keys (Stripe, Vapi, Meta, Twilio, Vercel Blob).
