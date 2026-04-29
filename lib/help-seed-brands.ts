/**
 * Help center seed data for the "Brands" category — the deep series
 * covering whitelabel agency setup, multi-brand operator workflow,
 * transcript exports, knowledge strategy, and audits.
 *
 * Shared with /api/help/seed-brands (admin-triggered reseed). Idempotent
 * — keyed by slug. The seed-brands handler also prunes any article in
 * this category whose slug isn't in the file anymore, so editing-out an
 * article retires it on next reseed.
 */
export const BRANDS_CATEGORY = {
  slug: 'brands',
  name: 'Brands',
  description: 'Run a whitelabel support team across multiple client brands from one workspace. Setup, knowledge strategy, inbox workflow, exports, and audits.',
  icon: '🏷️',
  // Position the Brands category just after Agents in the sidebar.
  // Operators discover Brands once they have multi-client traffic.
  order: 2,
}

export const BRANDS_ARTICLES = [
  // ───────────────────────────────────────────────────────────────────
  // 1. Overview
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-overview',
    title: 'What Brands are and when to use them',
    summary: 'Brands let one workspace represent many client identities. The mental model, the moving pieces, and the question to ask before you turn the feature on.',
    order: 10,
    body: `Brands are how you run a **whitelabel support team across many client
identities** from a single workspace. One queue, one set of operators,
one set of agents — but every conversation, every transcript, and every
piece of knowledge is cleanly tagged to the right client.

## Who Brands are for

You should turn on Brands if:

- **You operate as an agency, holdco, or MSP** representing multiple
  clients on each client's own widgets, hosted call pages, or support
  channels.
- **You whitelabel** — i.e. the visitor experience says "Acme Corp,"
  not "Voxility," even though you're the team behind it.
- **One support team handles many brands** rather than spinning up a
  workspace per client. (Workspaces stay separate when you need
  separate billing, separate operator rosters, or contractual data
  isolation. Brands solve everything *short* of that.)

If you only ever represent one company, you can skip Brands entirely
— the inbox doesn't even show brand controls when no brands are
defined. Nothing changes.

## The mental model

Three things in your workspace can be tagged to a Brand:

- **Widgets** — every chat or click-to-call widget can carry a brand.
  Conversations from that widget inherit the brand automatically.
- **Knowledge collections** — a collection can be brand-scoped (only
  relevant to one client) or shared (used across every brand —
  typical for your team's voice or methodology).
- **Reporting and exports** — the inbox filters by brand, transcript
  exports are brand-scoped, and any future per-brand metrics flow
  through the same tag.

Agents themselves don't get tagged to a brand. They pull from
**collections**, and collections are what's brand-scoped. So a single
agent can serve multiple brands by using the right mix of brand-scoped
+ shared collections.

## What stays separate per brand

Out of the box, when you tag a widget and its collections to a brand:

- Conversations from that widget show a **brand chip** on every inbox
  row (logo + accent color).
- The inbox **brand filter** lets operators scope to one brand at a
  time. Untagged widgets show up as "Untagged."
- **Transcript exports** download every conversation tagged to that
  brand as JSON or text, with optional date range and status filters.
- **Brand-scoped collections** show up only when an agent is
  explicitly attached to them — so an agent serving Acme doesn't
  accidentally pull facts about Beta into its system prompt.

## What stays shared

These don't change per brand:

- **Operators** (workspace members) — your team works every brand
  from one inbox.
- **Agents themselves** — same agents can handle multiple brands by
  attaching different collection mixes.
- **Notification channels, billing, integrations** — workspace-level.
- **Routing rules, presence, working hours** — workspace-level (with
  per-widget overrides for routing mode and eligible operators).

## When NOT to use Brands

Don't reach for Brands if:

- You need **separate billing per client.** That's still a workspace
  per client.
- You need **separate operator rosters** that can't see each other's
  data. Same — separate workspaces.
- You need **per-brand legal data isolation** (e.g. SOC 2 scope
  separation). Same.

Brands are about **organisation and reporting** within a shared team
and shared infrastructure. The data still lives in one workspace.

## Next

The next article walks through setting up your first brand and
tagging your first widget. After that, the series covers knowledge
strategy, the operator inbox workflow, transcript exports, and the
patterns that work for a 5-brand vs 50-brand team.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 2. Setting up your first brand
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-setup',
    title: 'Setting up your first brand',
    summary: 'Create a brand, tag a widget, and verify it lands correctly in the inbox. Five-minute walkthrough for a single client.',
    order: 20,
    body: `Setting up a brand is short. Creating one is one screen; tagging a
widget is one dropdown; everything else is automatic. This article
walks through one client end-to-end so you have a working setup before
the rest of the series gets into strategy.

## Step 1 — Create the brand

1. Open **Brands** in the left nav (between Templates and Widgets).
2. Click **+ New brand**.
3. Fill in:
   - **Name** — the human label ("Acme Corp"). Visible to your team
     in the inbox; not visible to the client's visitors.
   - **Slug** — auto-derived from the name. Used in transcript export
     filenames and the brand-scoped inbox URL (\`?brand=acme-corp\`).
     Lowercase letters / numbers / dashes.
   - **Description** — optional notes. Useful for "this is the
     account from the contract starting Jan 2025."
   - **Logo URL** — optional but recommended. Renders as a small
     badge on every inbox row, so operators can pattern-match brand
     by logo at a glance.
   - **Accent color** — used for the brand chip's tinted background.
4. Hit **Create**.

## Step 2 — Tag a widget

Brands are useful only when something is tagged to them. Pick (or
create) a widget for this brand.

1. Open **Widgets** → \\[your widget\\].
2. In the **Routing** section, find the **Brand** dropdown at the top.
3. Pick the brand you just created.
4. Save.

If this widget represents only Acme (the typical case for a
whitelabel setup — you'd build a separate widget per client), you're
done with widget tagging.

## Step 3 — Verify the inbox

Send a test conversation through the widget (open the widget on its
hosted page or your test domain, send a message).

1. Open **Inbox** in the left nav.
2. The new conversation should show:
   - A **brand chip** with the brand's logo + accent color on the
     row, next to the visitor name.
   - A new **Brand** filter row at the top of the inbox (above the
     status tabs) — appears once the workspace has at least one brand.
3. Click the **Acme Corp** chip in the brand filter row to scope the
   inbox to that brand. The URL updates to \`?brand=acme-corp\`.
4. While scoped, an **Export Acme Corp ↓** button appears in the
   right of the brand filter row. Clicking it downloads a JSON file
   of every conversation under that brand.

## Step 4 — (Optional) Tag knowledge

If you have client-specific knowledge — refund policy, shipping
windows, product specs — wire it up now so the agent has the right
context when it sees an Acme chat.

1. Open **Knowledge** in the left nav.
2. Click **+ New collection**.
3. In the modal, you'll see a new **Brand** dropdown (only renders
   when the workspace has brands defined).
4. Pick **Acme Corp**. Add a name like "Acme — refund policy."
5. Open the collection, write the content (or upload a PDF, crawl a
   URL, etc.), and connect the collection to whichever agent serves
   Acme.

## Done

That's a single brand fully wired up — widget + (optional) knowledge
+ inbox visibility + export. The same pattern repeats for each
client. The next article gets into the more interesting question:
how to structure knowledge across many brands without duplicating.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 3. Knowledge strategy
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-knowledge-strategy',
    title: 'Designing knowledge for multiple brands',
    summary: 'Brand-scoped vs shared collections, how to avoid duplication, and the layout that scales from 2 to 50 brands without rewrites.',
    order: 30,
    body: `Once you have multiple brands, the question isn't "where does each
piece of knowledge go" — it's **what should be shared across every
brand vs what should be brand-specific**. Get this right early and a
50-brand setup is just as clean as a 2-brand one. Get it wrong and
every new brand becomes a copy-paste exercise.

## The two collection types

Knowledge collections come in two flavours:

- **Brand-scoped** — collection has a brand tag. "Acme refund
  policy," "Beta shipping windows."
- **Shared** — no brand tag. Used by agents serving any brand.
  Usually about *how* you work, not *what* the client does.

Both are first-class. An agent can use any mix.

## What belongs in shared collections

Anything that's about **your team's method**, not the client's
business. The same regardless of whose chat you're handling:

- **Brand voice / tone guide** — "We sound friendly, never use
  jargon, never quote prices in a chat." (Note: this is *your* brand
  voice as a service team, not the client's.)
- **Escalation playbook** — when to hand off to a human, what
  questions to qualify on, how to handle angry visitors.
- **Compliance basics** — never collect a credit card in chat, never
  promise refunds without operator approval.
- **Methodology docs** — how your team approaches discovery,
  scheduling, etc.

These collections never change between brands. A new brand inherits
them automatically (just attach the agent serving the new brand to
these collections).

## What belongs in brand-scoped collections

Anything that's **about the client's business**:

- **Refund / return policy** for that brand.
- **Product specs, SKUs, pricing tiers** for that brand.
- **Shipping windows, service areas, hours of operation.**
- **FAQs specific to that brand's customers.**
- **Live data sources** — Sheets, Airtable bases, REST endpoints
  that hold that client's inventory or pricing.

Each of these gets a brand-scoped collection. A useful naming
convention is \`<brand>: <topic>\` so the collection list reads cleanly
when filtered:

\`\`\`
Acme: refund policy
Acme: product specs
Acme: shipping windows
Beta: refund policy
Beta: product specs
\`\`\`

## The agent setup that scales

For each brand, build (or reuse) an agent and attach:

1. **All the shared collections** (brand voice, escalation, etc.).
2. **All the brand-scoped collections for that one brand only.**

That's it. The agent gets the workspace's universal method on top of
the client's specific facts.

When you onboard a new client, the workflow is:

1. Create the brand under **Brands**.
2. Create their brand-scoped collections under **Knowledge** (or
   clone an existing brand's set as a starting point — see below).
3. Spin up (or duplicate) an agent and attach the new client's
   collections + the same shared collections everyone uses.
4. Tag a widget to the new brand and point it at the new agent.

## Don't duplicate "how-to-be-helpful" per brand

A common mistake: writing a brand-voice doc inside every brand's
collection set. The day you decide to soften the team's voice (or
tighten escalation rules), you have N copies to update.

Stay disciplined: anything that *would be the same across every
brand* goes in a shared collection.

## Live data sources are brand-scoped

Sheets / Airtable / REST endpoints almost always go in **brand-scoped**
collections — Acme's inventory Sheet, not yours. Stash them in the
brand's collection. Only the agent attached to that collection can
call those tools.

## Cloning a brand's setup

There's no built-in clone, but the pattern is fast:

1. Open the source brand's collections one at a time.
2. For each, click **+ New collection** in Knowledge with the new
   brand selected, copy the items across (write tab — the structured
   content carries cleanly).
3. Reconnect the new collections to the new agent.

A future release will turn this into a one-click duplicate. For now
the manual flow works for every team I've seen up to ~10 brands.

## When a brand-scoped item should be promoted to shared

If you find yourself copying the same content into 3+ brands' refund
policies, that's a hint the policy is actually *your* policy on
behalf of clients — promote it to a shared collection. Better to
have one shared "Refund handling — escalation rules" collection plus
three small brand-scoped "Refund window — Acme / Beta / Delta"
collections (with just the dates), than three full duplicates.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 4. Inbox workflow
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-inbox-workflow',
    title: 'Working the inbox across multiple brands',
    summary: 'Operator workflow for a multi-brand queue: filtering, scoping, claiming, and avoiding the "wrong-brand" mistake.',
    order: 40,
    body: `For an operator working across multiple brands all day, the inbox is
where the magic has to happen — chips, filters, and assignment all
need to make brand context obvious without slowing down. Here's how
the inbox is structured for multi-brand teams and the patterns
operators settle into.

## The brand filter row

When the workspace has at least one brand defined, a new **Brand**
filter row appears above the status tabs:

- **All** — every conversation, brand or not. The default.
- **Untagged** — conversations from widgets that aren't tagged to any
  brand. Useful as a hygiene view: if you're trying to run everything
  through brands, anything in Untagged is a tagging gap.
- **One chip per brand** — click to scope. The URL syncs
  \`?brand=<slug>\` so you can deep-link or share a brand-scoped view.

Each chip shows the brand's logo (small) + a colored dot in the
brand's accent color. Operators learn brand-by-glance after about a
day.

## Brand chips on every row

In addition to the filter, every conversation row carries a brand
chip in the row header — also with logo + accent color, also a
visual at-a-glance signal. The chip uses the brand's accent color as
the background tint, so a list scrolling by reads as "Acme orange,
Acme orange, Beta green, Acme orange…"

Untagged conversations don't have a chip — easy to spot if your
hygiene rule is "every conversation should have a brand."

## A typical operator's day

Two patterns work well:

**Pattern A — work the All view, scope when needed.** Operator sits
on **All / Live / Assigned to me** (or **Unassigned** if claiming
from queue). Every row's chip tells them which brand they're on.
They scope to a specific brand only when triaging a backlog or
exporting transcripts.

**Pattern B — scope to one brand at a time.** A team that splits
brands by operator (you handle Acme + Delta, I handle Beta) might
prefer landing directly on \`?brand=acme-corp\` as their bookmark.
The brand filter persists in the URL so this pins cleanly.

Most teams converge on Pattern A within a week. Pattern B works for
contractually-isolated brands where you want zero accidental
cross-pollination.

## The "wrong-brand reply" mistake

Without a brand chip, the failure mode is: an operator reads a chat,
forgets which client this is for, and replies with phrasing or
content from another client. Result: visitor gets a "we have a 30-day
return window" reply when *that brand's* policy is actually 14 days.

The brand chip + the agent's collection setup stop this two ways:

1. **The chip is always visible** — header, every row, the assignee
   dropdown. There's no screen where the brand is hidden.
2. **The agent only loads the right brand's collections.** If the
   operator hands off mid-chat (clicks the assignee chip and assigns
   to themselves, then types a reply), the agent's prompt context
   that informed earlier turns was already brand-scoped — they
   inherit the correct facts.

## Routing rules across brands

The Intercom-style routing config (manual / round-robin /
lightest-load) is **per widget**, not per brand. So you can run
different routing modes per brand by setting it on each brand's
widget:

- Acme: round-robin across operators A, B, C.
- Beta: lightest-load across operators B, C, D.
- Delta: manual (chats sit unassigned for the dedicated Delta
  operator to claim).

If you want **brand-specific operator rosters** (only A and B can
take Acme chats), set Acme's widget routing-target-userIds to just A
and B. Round-robin or lightest-load skips anyone outside that list.

## Search across brands

The inbox search box matches **brand name** in addition to visitor
name, email, message content, widget name, and assignee. Typing
\`acme\` narrows to every Acme-tagged conversation regardless of any
other filter — handy when an operator remembers "Acme had a refund
question last week" without remembering the visitor's email.

## Mark resolved + status flow

The status tabs (Live / Handed off / Ended / All) compose with the
brand filter, not replace. So **Ended + Acme** gives you every
closed Acme conversation. Useful for end-of-quarter audits.

## What hasn't changed

The single-conversation experience (header, sidebar, message
composer, CSAT, attachments, voice) is unchanged. Brands only affect
*organisation* — what shows in the list and what gets filtered. Once
you're inside a conversation, the operator UI is the same as it
always was.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 5. Transcript exports & audits
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-transcript-exports',
    title: 'Per-brand transcript exports and audits',
    summary: 'JSON and text export formats, date-range filters, automation patterns, and what to send a client during a quarterly review.',
    order: 50,
    body: `Sooner or later a client asks for "every conversation that came
through us last quarter." That request used to mean a JOIN across
widgets, conversations, and messages with a hand-rolled CSV. Per-brand
exports cover it in one click.

## Two formats

**JSON** (default) — full structured export. Every conversation, every
message, CSAT ratings, assignment metadata, timestamps. Filename:
\`<brand-slug>-transcripts-<date>.json\`.

\`\`\`
GET /api/workspaces/:wid/brands/:bid/transcripts/export?format=json
\`\`\`

Best for:
- Programmatic re-ingest (loading into the client's CRM or BI).
- Audit trails where you want to preserve everything.
- Future re-imports — JSON round-trips cleanly.

**Text** — human-readable plain text concatenation. One transcript
after another, separated by horizontal rules, with visitor / agent /
system labels.

\`\`\`
GET /api/workspaces/:wid/brands/:bid/transcripts/export?format=text
\`\`\`

Best for:
- A client asking "what did we talk about with Sarah last month?"
- QA review (skim transcripts for tone, accuracy).
- Internal training corpora.

Both formats are downloads — the response sets a
\`Content-Disposition: attachment\` header with a sensible filename.

## Filters

Three optional query parameters narrow the export:

- \`from=YYYY-MM-DD\` — earliest createdAt to include.
- \`to=YYYY-MM-DD\` — latest createdAt to include.
- \`status=ended\` (or \`active\` or \`handed_off\`) — narrow to one status.

Everything composes. \`?status=ended&from=2025-01-01&to=2025-03-31\`
gives every closed conversation from Q1.

## The 1,000-conversation cap

Each export response is capped at 1,000 conversations to avoid
runaway memory usage. For larger archives, chunk the export by date
range:

\`\`\`bash
# January
curl '...?format=json&from=2025-01-01&to=2025-01-31' > acme-jan.json
# February
curl '...?format=json&from=2025-02-01&to=2025-02-28' > acme-feb.json
# March
curl '...?format=json&from=2025-03-01&to=2025-03-31' > acme-mar.json
\`\`\`

This is the right pattern for any contract requiring a full quarterly
or yearly audit — chunk monthly, keep the files small enough to
review individually, and concatenate downstream if you need a single
file.

## The "send the client a transcript log every Friday" pattern

A common ask: an agency ships a weekly digest of conversations to
each client. Easiest setup:

1. Cron job hits the brand-scoped export with last 7 days as the
   date range:
   \`?format=text&from=<today-7>&to=<today>\`
2. Email the resulting text file to the client's primary contact.

The text format is good here because it's readable inline — no
"please install JSON viewer" friction.

## Quarterly business review pattern

For QBRs the JSON format is more flexible:

1. Pull the quarter's JSON.
2. Aggregate counts by status, mean CSAT, response times, top FAQs.
3. Build slides from the aggregates; attach the JSON to the deck for
   the client's auditor.

Future releases will surface a per-brand reporting dashboard so this
aggregation doesn't have to live in your scripts. For now, the JSON
export is the source of truth.

## What the export contains per conversation

Every conversation in the JSON looks like this:

\`\`\`json
{
  "id": "wcv_xxx",
  "widget": { "id", "name" },
  "visitor": { "id", "name", "email", "phone" },
  "status": "ended",
  "assignedUser": { "id", "name", "email" },
  "assignmentReason": "manual",
  "assignedAt": "2025-…",
  "csatRating": 5,
  "csatComment": "Great help",
  "csatSubmittedAt": "2025-…",
  "createdAt": "2025-…",
  "lastMessageAt": "2025-…",
  "messages": [
    { "role": "visitor", "kind": "text", "content": "...", "createdAt": "..." },
    { "role": "agent",   "kind": "text", "content": "...", "createdAt": "..." }
  ]
}
\`\`\`

Notably *missing*: secrets, internal notes, MCP credentials, or any
operator-private workspace data. The export is everything a client is
entitled to see — nothing more.

## Audit trail

Every export call hits the API with the operator's session, so you
can trace who exported what when via standard request logs. There's
no current per-brand "who exported this" log surfaced in the UI,
though — if you need that for compliance, request it as a feature.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 6. Agent strategy
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-agent-strategy',
    title: 'One agent vs many — agent patterns for multi-brand teams',
    summary: 'When to share an agent across brands, when to dedicate one per brand, and how to evolve your setup as you add clients.',
    order: 60,
    body: `Agents don't get tagged to a brand directly — they get attached to
**collections**, and collections are what's brand-scoped. So how
many agents you run for a multi-brand setup is a strategic decision,
not a structural one. Three patterns work, depending on team size
and client mix.

## Pattern 1 — One agent per brand

Each brand has its own dedicated agent. The agent is attached to that
brand's collections + every shared collection. It only ever serves
chats for that brand's widget(s).

**Pros:**
- Cleanest mental model. "This agent is Acme's agent."
- System prompt can carry brand-specific framing if needed
  ("You represent Acme Corp, a B2B SaaS for…").
- Per-agent tuning (response length, formality, never-say list) can
  diverge per client without affecting others.

**Cons:**
- More agents to maintain. For a 30-brand agency, that's 30 agents
  (and 30 agent settings pages, 30 routing rules…).
- Tuning improvements you discover for one brand have to be manually
  ported to others.

**When to use:** small brand portfolio (<10 brands), or when each
brand has materially different system-prompt needs (different tone,
different fallback behaviour, different judge rules).

## Pattern 2 — One agent serving every brand

A single agent attached to every brand-scoped collection plus every
shared collection. Routing happens at the **widget** level — each
brand's widget has the same defaultAgentId.

**Pros:**
- One agent to maintain. Tune system prompt once, every brand
  benefits.
- Cheap to add a new brand: create the brand, create the
  collections, tag a widget. The shared agent picks them up.
- Simpler operator mental model (less to look at on the agents page).

**Cons:**
- The agent's system prompt loads **every brand's collections** at
  prompt-build time. That's a lot of context for the model. For
  agencies with many brand-scoped collections this hits token
  budgets fast.
- The system prompt can't carry per-brand framing — it has to be
  brand-agnostic.
- A bug in tuning hits every brand at once.

**When to use:** small workspaces (1–3 brands) where token budget
isn't an issue, or workspaces with very thin per-brand knowledge.

**Important:** the prompt builder uses the agent's *attached
collections* as the context source. If the agent is attached to all
brands' collections at once, every conversation sees every brand's
content — not what you want for whitelabel separation.

The fix is **Pattern 3.**

## Pattern 3 — Per-widget agent with shared template (recommended)

The pragmatic middle ground:

1. Build a **template agent** with the shared collections (brand
   voice, escalation, methodology) and your standard tuning.
2. For each brand, **clone** the template agent, attach the brand's
   specific collections on top, and point that brand's widget at the
   clone.

**Pros:**
- Each brand has a dedicated agent that only sees its own +
  shared collections (clean separation, predictable token budget).
- Tuning improvements to the template propagate when you re-clone.
- New brands take ~5 minutes: clone, attach the brand's collections,
  point the widget.

**Cons:**
- You don't get *automatic* propagation when you tweak the template
  — you'd re-clone or manually update each brand's agent. (Future
  release: shared base agent with per-brand collection overrides.
  For now: manual.)

**When to use:** anything beyond ~5 brands. This pattern scales to
50+ without ceremony.

## Naming conventions that help

When you're running 10+ agents for 10 brands, naming matters:

- **Agents:** \`<Brand> — <role>\`. E.g. "Acme — Inbound,"
  "Acme — Voice," "Beta — Inbound."
- **Collections:** brand-scoped collections always start with
  \`<Brand>: <topic>\`. Shared collections start with no prefix.
- **Brand slugs:** match the brand display name (Acme → \`acme\`).
  Used in URLs and export filenames.

The agents page sorts alphabetically; this convention groups every
brand's agents together.

## Voice agents

If you're running voice agents per brand (each with its own VAPI
phone number), the same pattern applies. Each brand's voice agent
gets its own phone number and its own collection mix. The brand chip
shows on inbound voice conversations the same way it does on chat.

## Don't fork shared collections per agent

Common mistake: cloning a shared collection per agent so each agent
has its "own" copy. Don't. Stack the shared collection onto every
agent that needs it — that way you maintain it once and every agent
sees the latest version on the next conversation turn.

The point of Pattern 3 is to give each agent its own *brand-scoped*
context while sharing the universal stuff. Shared collections stay
shared.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 7. Operational scenarios — onboarding, audits, offboarding
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-operational-playbook',
    title: 'Onboarding, audits, and offboarding clients',
    summary: 'Concrete playbooks for the recurring operational moments — bringing on a new client, running an audit, ending a contract.',
    order: 70,
    body: `The features are one thing; the operational rhythm is another. Here
are the recurring moments in an agency's life — bringing on a new
client, running quarterly audits, and ending a contract — and the
exact playbooks for each.

## New client onboarding

A new client needs a brand, knowledge, an agent, and a widget. Here's
the order of operations that gets them live in under an hour
(assuming you have client-supplied content ready).

**1. Create the brand (2 min).**
Brands tab → + New brand. Name, slug, logo, accent. Save.

**2. Build the brand-scoped knowledge (20–60 min).**
This is where most of the time goes. Knowledge tab → + New collection
for each topic (refunds, pricing, FAQs, hours). Pick the brand
during creation. Add items via Write, file upload, or URL crawl.

For most clients, target three brand-scoped collections:
- \`<Brand>: FAQs\` — the most common questions and answers.
- \`<Brand>: Policies\` — refund / shipping / SLA / etc.
- \`<Brand>: Live data\` — Sheets / Airtable / REST data sources, if any.

**3. Spin up the agent (5 min).**
Agents → clone your template agent (or duplicate an existing
brand's agent). Rename to \`<Brand> — Inbound\`. Attach the new
brand's collections + every shared collection your template uses.
Optional: tweak the system prompt to mention the brand by name
("You represent <Brand>, a …").

**4. Create the widget (5 min).**
Widgets → + New widget. Pick chat or click-to-call. Set the brand
in Routing. Set the default agent to the new <Brand> — Inbound
agent. Configure the appearance (logo, primary color, allowed
domains for the client's site).

**5. Test and hand off (10 min).**
Open the widget on a test page or its hosted URL. Send a few
representative messages. Verify:
- The brand chip shows on the inbox row.
- The agent answers using the brand's knowledge (ask a question only
  in their FAQs).
- The agent doesn't bleed into another brand's content (ask about a
  policy unique to a different brand — agent should say it doesn't
  know).

Once that all works, hand the install snippet (or hosted page URL)
to the client.

## Quarterly business review (QBR)

For a typical quarterly review with a client:

**1. Pull the quarter's transcripts.**
Brands → \\[client\\] → Export ↓. Or:
\`GET /workspaces/:wid/brands/:bid/transcripts/export?format=json&from=2025-01-01&to=2025-03-31\`

If the quarter has more than 1,000 conversations, chunk by month.

**2. Aggregate the basics.**
From the JSON: total conversations, mean CSAT, conversations per
status (active / handed-off / ended), top widgets by volume, average
response time.

**3. Surface representative transcripts.**
From the text export: pick 5–10 transcripts that show the agent at
its best (high CSAT, smooth resolution) and 2–3 that show edge
cases the team handled well or that would benefit from a knowledge
update.

**4. Send the client a digest + a couple of recommendations.**
"Here's what we did. Here's what we noticed. Here are two knowledge
updates we'd recommend for next quarter."

The export is the raw material. The aggregation is your team's
craft.

## Mid-contract knowledge updates

Clients change policies. You'll get a Slack message: "Hey, we just
moved our refund window from 14 to 30 days." Workflow:

1. Open Knowledge → \\[Brand\\]: Policies (or whatever collection
   holds the refund language).
2. Find the refund entry, click Edit.
3. Update the content. Save.

Every agent connected to that collection will pick up the change on
the next conversation turn — no agent restart, no resync. The agent
that handled a chat 5 minutes ago will use the new content for the
chat that arrives in 5 seconds.

## Offboarding (contract ends, client leaves)

When a contract ends and you need to wind down a brand cleanly:

**1. Send the final export.** Run a JSON export of *everything* for
that brand:
\`?format=json&from=2020-01-01&to=<today>\`
(or a date earlier than the brand was created, for "everything").
Hand the file to the client as the official record.

**2. Pause the widget.** Widgets → \\[client widget\\] → toggle
**isActive** off. The widget stops accepting visitors but the
historical data stays.

**3. Decide on data retention.** Three options:
   - **Keep everything.** Pause the widget; leave the brand,
     collections, and conversations untouched. Useful if there's any
     chance of re-engagement.
   - **Archive the brand.** Delete the brand entity. Widgets and
     collections survive — they just become "Untagged." Inbox stops
     filtering on the brand. Conversations are still in the
     workspace.
   - **Hard delete.** Delete the widget (cascades to conversations,
     messages, visitors). Delete the brand-scoped collections. Done
     — only the agent and any shared collections remain.

The right choice depends on the contract. Default to "keep
everything" unless the contract requires deletion.

**4. Clean up the agent.** If the agent was dedicated to that
client (Pattern 3), either delete it (Agents → \\[agent\\] → Delete)
or detach the brand's collections from it.

## Re-onboarding a churned client

If a former client comes back, the rebuild is short:

1. **If you kept everything:** un-pause the widget, the brand still
   exists, the agent still exists. Maybe update knowledge to reflect
   any policy changes during the gap. You're live in 10 minutes.
2. **If you archived:** the conversations and collections are still
   there — just unattached. Recreate the brand with the same slug,
   re-tag the widget and collections to it. Live in 15 minutes.
3. **If you hard-deleted:** start from "New client onboarding"
   above.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // 8. Migration / FAQ
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-migration-and-faq',
    title: 'Migration + FAQ — moving from per-workspace to brands',
    summary: 'Consolidating multiple per-client workspaces into one with brands, and the questions that come up in the first week.',
    order: 80,
    body: `Some agencies stand up Brands greenfield — but most arrive with a
workspace per client and want to consolidate. This article covers
the migration path, plus the questions teams ask in the first week
of running brands.

## Migrating from one-workspace-per-client

If you currently have a separate workspace per client and want to
consolidate to one workspace with brands, the migration is mostly a
data move. There's no built-in cross-workspace import — the safe
path is manual.

**Decide if consolidation is the right move.** Brands cover
organisation and reporting. They do *not* give you per-client
billing isolation, separate operator rosters that can't see each
other, or per-client SOC 2 scope separation. If any of those matter
contractually, stay on separate workspaces.

If consolidation is right, the playbook is:

**1. Pick a "destination" workspace.** Usually the largest or
oldest. Everything will live here.

**2. For each source workspace (each existing client):**

   a. **Create the brand** in the destination workspace
      (Brands → + New brand). Use the source workspace's name as the
      brand name.

   b. **Recreate the knowledge.** For each collection in the source
      workspace's Knowledge:
      - Create a new collection in destination, tagged to the brand.
      - Copy the items across (open each entry, copy content, paste
        into a new entry in the destination collection).
      - Wire up data sources fresh — they need new credentials
        because tokens are workspace-scoped (the destination workspace
        doesn't have the source's secrets).

   c. **Recreate the agent.** Clone your template agent in
      destination, attach the brand's collections + shared
      collections, tweak system prompt if the source agent had
      brand-specific framing.

   d. **Create the widget** in destination tagged to the brand,
      pointing at the new agent. Use the same display name and
      styling so the visitor experience doesn't change.

   e. **Update the install snippet on the client's site** — the new
      widget has a new public key. This is the cutover moment.
      Visitors who land after the snippet swap go through the
      consolidated setup.

   f. **Export historical transcripts** from the source workspace
      while it still has them. Brand-scoped exports don't reach into
      other workspaces, so source-workspace transcripts stay there
      unless you export them out.

**3. Run side-by-side for a week.** Don't delete the source
workspaces immediately. Let the destination handle live traffic for
a few days, verify nothing's broken, then archive (don't delete) the
source. Hard-delete only after a comfortable buffer (30–90 days,
depending on contract).

## Questions teams ask in the first week

**Q: Can a widget belong to more than one brand?**
No. A widget has at most one brand. If you have a widget that
genuinely serves multiple brands, you probably want separate widgets.

**Q: Can a collection belong to more than one brand?**
No, but it can belong to *no* brand (shared) and be attached to
agents for any brand. So the multi-brand sharing pattern is "shared
collection, attached to multiple brand agents."

**Q: What happens to conversations when I delete a brand?**
Nothing happens to the conversations. The widget they came from
becomes untagged (the brandId on the widget is set to null), and
the inbox stops grouping them under the deleted brand. Data is
preserved.

**Q: Can I rename a brand?**
Yes. Brands → \\[brand\\] → edit. Renaming the slug changes the URL
syntax (\`?brand=new-slug\` instead of \`?brand=old-slug\`) and the
default export filename, but doesn't affect any tagged content.

**Q: Will visitors see the brand name?**
Not unless you put it in the agent's system prompt or in user-facing
collection content. The brand chip is operator-only. Visitor-facing
branding lives on the widget itself (logo, primary color, title,
welcome message).

**Q: Can I assign brands to specific operators only?**
Indirectly. Set the widget's routing-target-userIds (in the widget
editor under Routing) to only the operators you want. Round-robin
and lightest-load skip everyone else. There's no global "operator
can only see Acme" setting today — every workspace member can see
every brand. Per-brand access controls are on the roadmap if there's
demand.

**Q: How do I see metrics per brand?**
Today: scope the inbox by brand and look at counts; pull the JSON
export and aggregate. A per-brand reporting dashboard is the natural
next layer of the feature; expected soon.

**Q: Does the agent know which brand it's serving?**
Implicitly: it loads only the brand's collections (plus shared).
Explicitly: only if you put the brand name in the system prompt.

If you want the agent to mention the brand by name explicitly,
follow the **Pattern 3** approach (one cloned agent per brand) and
edit the system prompt. If you want a single agent to figure out
which brand it's representing, you'd need to inject the brand into
the prompt at runtime — there's no built-in mechanic for that yet.

**Q: What happens to the brand chip if I un-tag a widget?**
Conversations from that widget lose the brand chip. They'll show up
in **Untagged** in the brand filter. Existing conversations don't
re-tag retroactively; only future conversations follow the new
configuration. (The brand reference is on the widget, not the
conversation, so the displayed brand follows the widget's *current*
state.)

**Q: Is there an undo on brand delete?**
No — deletion is permanent (the brand row is gone). The good news is
that nothing else cascades: widgets and collections become untagged
but survive. So the "undo" is to recreate the brand with the same
name + tag the widgets and collections back.
`,
  },
]
