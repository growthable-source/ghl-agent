#!/usr/bin/env node
/**
 * Seed (or refresh) the public "Try Now" demo Co-Pilot agent.
 *
 * The marketing site's "Try Now" button points at a published, no-login
 * agent link: /copilot/live/{publicKey}. That route needs a CopilotAgent
 * row with published=true and a publicKey, on a workspace that passes the
 * copilot plan gate (Scale tier OR in COPILOT_WORKSPACE_ALLOWLIST).
 *
 * The publicKey is FIXED below so the marketing URL is known in advance
 * and never changes when this is re-run. The upsert is idempotent
 * (ON CONFLICT on publicKey) — run it again any time to refresh the demo
 * persona/steps/playbook without breaking the live link.
 *
 * Raw pg (not Prisma client) to match scripts/prisma-migrate.mjs and avoid
 * needing the generated client. Reads POSTGRES_PRISMA_URL / POSTGRES_URL /
 * DATABASE_URL in that order — point it at the same DB the app uses.
 *
 * Run:
 *   node scripts/seed-demo-copilot.mjs
 * Optionally pin the workspace:
 *   DEMO_WORKSPACE_ID=ws_xxx node scripts/seed-demo-copilot.mjs
 */

import pg from 'pg'

// ─── Fixed identity (do not change once marketing links to it) ──────
const PUBLIC_KEY = 'cpa_e8CGCNOv2Lq53Nft6NXXP7RU'
const AGENT_ID = 'cb48f23a8915e180c9353e463'

// ─── Demo content ───────────────────────────────────────────────────
const NAME = 'Xovera Co-Pilot — Live Demo'
const TYPE = 'onboarding' // guided → leader stance in buildAgentPrompt
const PERSONA =
  'A sharp, friendly product specialist demoing Xovera’s live screen-share Co-Pilot. ' +
  'Warm, concise, and a little bit show-off — you love proving that you can actually see ' +
  'the screen and guide the person on it.'
const OPENING_LINE =
  'Hey! I’m the Xovera Co-Pilot. The moment you share your screen I can see it — share ' +
  'any tab or window and I’ll show you, live, how I’d guide one of your customers through it. ' +
  'Ready when you are.'
const STEPS = [
  'Welcome them, confirm you can see the screen they just shared, and call out one specific thing actually on it to prove it.',
  'Ask what they’re working on — then use annotate_screen to circle a real element and tell them exactly what you’d click or do next.',
  'Invite them to navigate anywhere (any page, their CRM, a website) and keep up — react to the new screen on your own, without being asked.',
  'In one breath, name what just happened: you watched their screen and guided them proactively — the way Xovera’s Co-Pilot guides their customers and staff.',
  'Wrap with a clear next step: they can put this on their own site or use it to onboard their team — invite them to get Xovera and set up their own.',
]
const TIMEBOX_MINUTES = 8
const PLAYBOOK =
  'You are a live demo of Xovera’s screen-share Co-Pilot, talking to a prospect who just ' +
  'arrived from the marketing site. WOW them in two minutes by proving three things, fast: ' +
  '(1) you genuinely see their screen — always take_a_closer_look before describing anything, ' +
  'and name something specific that is actually on it; (2) you guide proactively — when they ' +
  'navigate or go quiet, speak up on your own with the next action, never wait to be asked; ' +
  '(3) you point precisely — use annotate_screen to circle the exact element, then tell them to ' +
  'glance at the live-help panel. Keep every turn to one or two sentences, upbeat and concrete. ' +
  'Never claim to see something you have not confirmed. If something sensitive is on screen, ' +
  'guide past it without reading it aloud. Close by inviting them to get Xovera for their own ' +
  'business. This is a demo — you have no product knowledge base, so keep it about what is on ' +
  'their screen and the experience itself, not deep feature trivia.'

function pickConnectionString() {
  return process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? null
}

const COPILOT_PLANS = new Set(['scale']) // plans with copilotEnabled (see lib/plans.ts)

function allowlist() {
  return (process.env.COPILOT_WORKSPACE_ALLOWLIST || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

async function resolveWorkspaceId(client) {
  // 1) Explicit override.
  if (process.env.DEMO_WORKSPACE_ID) {
    const { rows } = await client.query('SELECT id, plan, name FROM "Workspace" WHERE id = $1', [
      process.env.DEMO_WORKSPACE_ID,
    ])
    if (!rows.length) throw new Error(`DEMO_WORKSPACE_ID ${process.env.DEMO_WORKSPACE_ID} not found`)
    return rows[0]
  }
  // 2) First existing allowlisted workspace.
  const al = allowlist()
  if (al.length) {
    const { rows } = await client.query('SELECT id, plan, name FROM "Workspace" WHERE id = ANY($1) LIMIT 1', [al])
    if (rows.length) return rows[0]
  }
  // 3) First Scale-tier workspace.
  const { rows } = await client.query(
    `SELECT id, plan, name FROM "Workspace" WHERE plan = ANY($1) ORDER BY "createdAt" ASC LIMIT 1`,
    [[...COPILOT_PLANS]],
  )
  if (rows.length) return rows[0]
  return null
}

async function main() {
  const connectionString = pickConnectionString()
  if (!connectionString) {
    console.error('[seed-demo] ✗ No DB URL set (POSTGRES_PRISMA_URL / POSTGRES_URL / DATABASE_URL).')
    process.exit(1)
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const ws = await resolveWorkspaceId(client)
    if (!ws) {
      console.error(
        '[seed-demo] ✗ No eligible workspace found. Set DEMO_WORKSPACE_ID=<id> for a Scale-tier or\n' +
          '            allowlisted workspace, or add one to COPILOT_WORKSPACE_ALLOWLIST.',
      )
      process.exit(1)
    }

    const gated = COPILOT_PLANS.has(ws.plan) || allowlist().includes(ws.id)
    if (!gated) {
      console.warn(
        `[seed-demo] ⚠ Workspace ${ws.id} (plan="${ws.plan}") does NOT pass the copilot gate.\n` +
          `            The demo link will return 503 until this workspace is on a Scale plan or you add\n` +
          `            ${ws.id} to COPILOT_WORKSPACE_ALLOWLIST in the app env (then redeploy).`,
      )
    }

    await client.query(
      `INSERT INTO "CopilotAgent"
         (id, "workspaceId", name, type, persona, "openingLine", "collectInfo",
          "knowledgeDomainIds", steps, "timeboxMinutes", playbook, "publicKey",
          published, "allowedDomains", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,true,$13,now())
       ON CONFLICT ("publicKey") DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         persona = EXCLUDED.persona,
         "openingLine" = EXCLUDED."openingLine",
         steps = EXCLUDED.steps,
         "timeboxMinutes" = EXCLUDED."timeboxMinutes",
         playbook = EXCLUDED.playbook,
         published = true`,
      [
        AGENT_ID,
        ws.id,
        NAME,
        TYPE,
        PERSONA,
        OPENING_LINE,
        null,
        [],
        JSON.stringify(STEPS),
        TIMEBOX_MINUTES,
        PLAYBOOK,
        PUBLIC_KEY,
        [],
      ],
    )

    console.log('[seed-demo] ✓ Demo Co-Pilot published.')
    console.log(`[seed-demo]   workspace: ${ws.name ?? ws.id} (${ws.id}, plan="${ws.plan}")`)
    console.log(`[seed-demo]   Try Now URL: https://app.xovera.io/copilot/live/${PUBLIC_KEY}`)
    if (!gated) console.log('[seed-demo]   NOTE: enable copilot for this workspace before the link will start sessions.')
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('[seed-demo] ✗', err)
  process.exit(1)
})
