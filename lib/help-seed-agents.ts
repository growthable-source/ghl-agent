/**
 * Help center seed data for the "Agents" category.
 *
 * Shared between /api/help/seed-agents (admin-triggered reseed) and the
 * scripts/seed-help-agents.mjs CLI script. Idempotent — keyed by article
 * slug, so editing a body here and rerunning republishes that article.
 */
export const AGENTS_CATEGORY = {
  slug: 'agents',
  name: 'Agents',
  description: 'Everything about building, deploying, and tuning AI agents.',
  icon: '🤖',
  order: 1,
}

// ── Articles ────────────────────────────────────────────────────────────
// Order matters in the UI — listed in the order someone new would

export const AGENTS_ARTICLES = [
  {
    slug: 'settings-system-prompt-fallback',
    title: 'Settings: system prompt, fallback, behaviour',
    summary: 'The core identity of your agent — who it is, what it does, and what it says when it hits a dead end.',
    order: 10,
    body: `The **Settings** tab is where you shape your agent's core identity. Everything else
(Rules, Tools, Persona, etc.) layers on top of this.

## System Prompt

The system prompt is the agent's job description. Keep it short, specific,
and focused on the outcome you want.

**Good:**

\`\`\`
You are a friendly inbound assistant for a beauty salon. You help contacts
book appointments, answer questions about services and pricing, and nudge
hesitant leads toward booking. Your primary goal is to get a confirmed booking.
\`\`\`

**Less good:**

\`\`\`
You are a helpful AI.
\`\`\`

The more context you give, the better the agent picks up on tone and
priorities. Pre-filled templates give you a strong starting point — edit
them to match your business.

## Behavioural Instructions

These are bullet-point rules the agent always follows. Think of them as
non-negotiable behaviours rather than narrative prompt content.

\`\`\`
- Never quote prices you're not 100% sure about
- If asked for a manager, immediately hand off
- Match the contact's energy — casual if they're casual, formal if formal
- Always confirm booking details back to the contact
\`\`\`

## Fallback Behaviour

What the agent does when it genuinely doesn't have an answer. Three modes:

- **Say a message** — speaks a pre-written line. Use when you want a
  consistent response (e.g. "Let me check with the team and get back to you").
- **Transfer to human** — pauses the agent immediately and fires your
  [human-handover notification](/help/a/human-handover-notifications).
- **Say a message, then transfer** — both. Speaks the line, then escalates.

The fallback message supports [merge fields](/help/a/merge-fields) so you can
personalise: \`Hi {{contact.first_name|there}}, let me check on that for you.\`

## Tips

- If you find yourself adding the same instruction to every agent, it
  probably belongs in the system prompt template itself — ping support.
- Short + specific beats long + generic. Every extra line adds tokens and
  dilutes focus.
- When in doubt, test changes in the Playground before they go live.`,
  },

  {
    slug: 'simple-vs-advanced-agents',
    title: 'Simple vs Advanced agents: picking a context level',
    summary: 'Advanced agents pre-load the contact\'s opportunities and custom fields into every turn. When to flip it on, what it costs, and when not to.',
    order: 12,
    body: `Every agent is one of two context levels. It's set when you create the
agent, shown on the agent's settings page, and can be flipped at any time —
no data migration, no downtime.

## The short version

- **Simple** — the default. The agent sees the contact's name, tags, and
  conversation history. That's it. Zero extra tokens per turn, zero extra
  API calls to GoHighLevel.
- **Advanced** — also sees the contact's recent opportunities and custom
  fields on every turn, plus a [Business Context](/help/a/business-context-glossary)
  glossary you write once. Costs more tokens per reply, but the agent can
  reason about specific deals, products, or pricing without having to
  stop and call a tool.

If your agent only handles generic questions ("what are your hours?",
"can I book an appointment?"), **use Simple**. If your agent needs to
discuss specific things the contact has already shown interest in
(vehicles, properties, courses, product SKUs, pending quotes), **use
Advanced**.

## What Advanced actually loads

Every time the agent replies, in addition to the usual prompt, it sees:

1. **Your Business Context glossary** — the plain-English explanation
   you wrote telling the agent what your custom fields and opportunities
   represent. This is where you say things like "Each opportunity is a
   specific vehicle the contact has inquired about. monetaryValue is
   the listed sale price in USD."
2. **The contact's custom fields** — only the ones with values. Shown
   as \`field_key: value\` pairs.
3. **Active opportunities** — up to **8 most recent** inquiries that
   are not won/lost/abandoned, from the last **~6 months**. Each one
   includes the name, monetary value in USD, stage, and any custom
   fields on that opportunity (like \`vehicle_color=red\`,
   \`vehicle_miles=42000\`).
4. **Recent closed opportunities** — up to **5 most recent** won, lost,
   or abandoned deals inside the same 6-month window. Useful so the
   agent knows "we already sold them a car last quarter" or "they
   passed on the Tacoma".

If the contact has more opportunities than fit in the snapshot, the
agent is told the exact number that were dropped and that it can call
\`get_opportunities\` for anything it can't see directly.

## What stays the same regardless

Both Simple and Advanced agents see:

- The contact's basic fields (name, phone, email, tags)
- Your agent's system prompt and extra instructions
- [Qualifying questions](/help/a/qualifying), [Rules](/help/a/rules),
  [Listening rules](/help/a/listening), [Tools](/help/a/tools)
- Prior conversation history
- Agent persona + working hours

Advanced doesn't replace any of this — it adds commercial context on
top. Everything you'd tune on a Simple agent tunes the same way on an
Advanced one.

## When to use Simple

- Customer support — the contact's issue is in the message, not in the
  CRM record
- Booking-only agents — time-slot lookups don't need past-deal context
- FAQ agents — the answers are in your knowledge base, not in the
  contact's opportunities
- High-volume outbound where token cost matters
- Any agent where the contact is usually brand-new and has no deal
  history to reason over

## When to use Advanced

- Car dealers — each opportunity is a vehicle, custom fields are specs,
  monetary value is the listed price
- Real estate agents — opportunities are properties shown, custom fields
  are square footage / bedrooms / price band
- B2B sales reps — opportunities are deals at different stages, custom
  fields are deal attributes (seat count, contract length)
- Quote-based services (trades, event vendors) — opportunities carry the
  itemised quote, custom fields carry specs
- Course and coaching providers — opportunities are programs the contact
  has looked at
- Anywhere a contact accumulates a **pipeline of specific things** and
  the agent needs to reference them by detail ("the red one", "the 2br")

## What it costs

Advanced is an opt-in because it isn't free:

- **Tokens per turn** — expect a few hundred extra tokens per reply,
  depending on how many opportunities and custom fields the contact has.
  On a lean contact (1–2 opportunities, a handful of fields), it's
  negligible. On a maxed-out snapshot (8 active + 5 closed with lots of
  custom fields each), it can add ~800–1500 tokens.
- **CRM API calls** — three extra calls on each turn: fetch
  opportunities, fetch contact custom-field definitions (to hydrate
  keys), fetch opportunity custom-field definitions. All three are
  parallelised, so they add about one round-trip of latency in the
  worst case.

No billing impact beyond normal token usage. If you hit GHL's rate
limit it'll be from a different workflow — the extra reads are light.

## How to switch

From the agent's base **Settings** page, the **Context Level** section
has a Simple / Advanced toggle. Flip it and hit Save. Changes take
effect on the *next* inbound — no downtime, no re-indexing.

Advanced-only fields (like your Business Context glossary) stick around
in the database even if you flip back to Simple, so you can toggle
freely during testing. When the agent is Simple, the glossary is just
dormant.

## When to pick at creation vs later

You'll pick a level in the new-agent wizard's **Build** step. Default
is Simple. There's no penalty to starting Simple and upgrading later,
and no penalty to starting Advanced and discovering you don't need it.
Pick whichever matches how you imagine the agent's first real
conversation going — you can always swap.

## Duplicating keeps the level

When you [duplicate an agent](/help/a/settings-system-prompt-fallback)
or save it as a template, both the Context Level and the Business
Context glossary come with it. Great for multi-location setups where
every dealership or every clinic uses the same glossary with minor
tweaks.

## Tool use isn't replaced

Even with Advanced on, your agent still has its normal tool palette
(\`get_opportunities\`, \`get_contact_details\`, etc.). Advanced is
about what the agent **knows without having to ask**. Tools are still
there for anything outside the pre-loaded snapshot (deeper history,
fresh stage lookups, cross-contact searches). The trade-off isn't
"context vs tools" — it's "start with context *then* tools if
needed."`,
  },

  {
    slug: 'business-context-glossary',
    title: 'Writing a Business Context glossary',
    summary: 'The free-text block that tells your Advanced agent what your custom fields and opportunities mean in your business.',
    order: 14,
    body: `The **Business Context** textarea only appears for
[Advanced agents](/help/a/simple-vs-advanced-agents). It's a free-text
explanation of your business that gets injected at the top of the
agent's system prompt on every turn, right before the contact data.

Its job is to turn raw CRM values into meaningful information. Without
a glossary, the agent sees this:

\`\`\`
Opportunity: 2019 Ford F-150 4x4 — $45,000 (open) stage: 8H2aKLmq
  vehicle_color=red, vehicle_year=2019, vehicle_miles=42000
\`\`\`

...and has to guess what any of it means. With a glossary, it knows
that monetaryValue is the listed sale price in USD, that
\`vehicle_*\` custom fields are car specs, and that the stage ID
corresponds to "Test Drive Scheduled".

## What to include

A good glossary answers these questions:

1. **What is your business?** One sentence. *"We are a used car
   dealership in Brisbane."*
2. **What does an opportunity represent?** Especially when it's not
   obviously a "deal." *"Each opportunity is a specific vehicle the
   contact has inquired about. One contact usually has 2–5 active
   opportunities as they compare cars."*
3. **What does monetaryValue mean?** *"Listed sale price in USD, not
   the negotiated price."*
4. **What do your custom field groups mean?** *"Custom fields starting
   with vehicle_ describe the car: vehicle_stock_id, vehicle_vin,
   vehicle_make, vehicle_model, vehicle_year, vehicle_color,
   vehicle_miles."*
5. **What are your pipeline stages?** *"Stages progress: New Inquiry →
   Test Drive Scheduled → Test Driven → Offer Made → Financing → Sold.
   A 'lost' status means they bought elsewhere or decided against."*
6. **How should the agent reference things naturally?** *"When the
   contact says 'that truck' or 'the silver one', cross-reference their
   active inquiries and pick the match by vehicle_color."*

You don't have to hit every one of those. Include only what the agent
will actually trip on without.

## Worked example: used car dealer

\`\`\`
We are a used car dealership. Each opportunity is a specific vehicle
the contact has inquired about — a single contact will usually have
2–5 active opportunities as they compare options. monetaryValue is
the listed sale price in USD (not the negotiated price).

Custom fields on opportunities describe the vehicle:
- vehicle_stock_id: our internal stock number (always starts with "S-")
- vehicle_make, vehicle_model, vehicle_year: self-explanatory
- vehicle_color, vehicle_miles: self-explanatory

Contact-level custom fields:
- budget_cap: contact's max budget in USD
- preferred_body_style: sedan / SUV / truck / wagon
- trade_in_vehicle: free-text description of what they're trading

Pipeline stages (in order): New Inquiry → Viewing Scheduled →
Viewed → Test Drive Scheduled → Test Driven → Offer Made →
Financing → Sold. A "lost" opportunity means they went elsewhere or
passed on it. A "won" opportunity is a completed sale.

When the contact says "that truck", "the red one", "the silver RAV4",
etc., cross-reference their active inquiries and pick the match.
If they ask about a vehicle not in their active inquiries, call
search_opportunities to see if it's in stock.
\`\`\`

## Worked example: B2B SaaS sales rep

\`\`\`
We sell a team productivity SaaS on monthly and annual plans. Each
opportunity is a deal in a specific pipeline stage; monetaryValue is
the annualised contract value in USD.

Opportunity custom fields:
- seat_count: number of user licences being discussed
- plan_tier: "Starter", "Pro", or "Enterprise"
- contract_length_months: typically 12 or 36
- primary_use_case: the main workflow they want to solve

Contact custom fields:
- role: usually "Founder", "Ops Manager", or "VP Engineering"
- company_size_band: 1-10, 11-50, 51-200, 201+
- current_tool: what they're using today (often Asana, Monday, or none)

Stages: Discovery → Demo Scheduled → Demo Done → Proposal Sent →
Verbal Yes → Legal Review → Signed. Lost usually means they went
with a competitor (logged in current_tool on close).

If the contact references "the proposal", check for an opportunity in
stage Proposal Sent and cite its monetaryValue + contract_length_months.
If they're weighing tiers, the plan_tier field tells you which one
they're considering on each open deal.
\`\`\`

## Worked example: trades / quote-based service

\`\`\`
We're a residential plumbing contractor. Opportunities are itemised
quotes — monetaryValue is the total quoted price in USD including GST.

Opportunity custom fields:
- job_type: "Emergency", "Renovation", "Maintenance", "New install"
- address: service address (not always the contact's home address)
- materials_cost: parts-only portion of the total
- labour_hours_estimated: our crew time estimate

Contact custom fields:
- preferred_contact_window: contact-provided time they want a call
- access_notes: keys, gate codes, dogs, parking — free text the tech
  needs before arrival
- property_type: "House", "Apartment", "Commercial"

Stages: Quote Requested → Quoted → Quote Accepted → Scheduled →
In Progress → Complete → Invoice Sent → Paid. A "lost" opportunity
means they went with another quote.

When the contact references "the quote" or "the bathroom job", pick
the most recently quoted opportunity. If they ask for a timeline,
check the stage first — "Scheduled" opportunities have an associated
appointment you can look up.
\`\`\`

## How to write it well

- **Be specific, not decorative.** The glossary is a reference doc for
  the agent, not marketing copy. Skip adjectives, include field names.
- **Name the fields exactly as they appear.** If your GHL custom field
  key is \`contact.inquired_vehicle_id\`, use that exact string. The
  agent matches on the keys it sees in the data.
- **Describe the units.** "USD" beats "dollars". "monthly" beats
  "recurring". "mm/dd/yyyy" beats "a date".
- **Give the agent permission to cross-reference.** Say things like
  "When the contact says X, look at Y." Without the hint, the agent
  often won't make the connection.
- **Keep it under ~500 words.** It's injected every turn, so shorter
  is cheaper. If you need more structure, split it into sections with
  \`##\` markdown headers.

## Common mistakes

- **Writing it as persona instructions.** The glossary describes the
  *data*, not the *voice*. Tone, formality, emojis, and style belong
  on the [Persona](/help/a/persona) page, not here.
- **Listing every field in GHL.** Only fields the agent will encounter
  are worth documenting. If no contact has a \`second_drivers_licence\`
  field populated, the agent never sees it and the glossary line is
  wasted.
- **Hardcoding pricing.** Put prices in your [Knowledge base](/help/a/knowledge),
  not here. Pricing changes — you don't want to re-save every agent
  when a tier goes up $5.
- **Describing workflow instead of data.** "When the contact agrees to
  a demo, book a slot" is a behaviour instruction, not a glossary
  entry. That belongs in **Extra Instructions**.

## When to update it

Update the glossary when:

- You add a new custom field category in GHL that opportunities will
  carry
- You rename a pipeline stage
- The meaning of an existing field shifts (e.g. monetaryValue starts
  including tax when it didn't before)
- Your agent misinterprets something the same way twice — odds are
  the glossary didn't tell it how

You don't need to touch it when:

- Your knowledge base updates (it's a separate layer)
- Rules or listening categories change
- You add a new channel or adjust working hours

## Testing

Use the Playground to simulate a conversation with a real contact ID.
The agent's system prompt (including your glossary and the live
contact data) is deterministic — if the agent can't answer "how much
is the red one?" when the red F-150 is clearly in the contact's
inquiries, the fix is almost always in the glossary or the custom
field names.`,
  },

  {
    slug: 'channels',
    title: 'Channels: where your agent runs',
    summary: 'SMS, WhatsApp, Instagram, Facebook, Google Business, Live Chat, Email. Pick the channels your agent listens on.',
    order: 20,
    body: `The **Channels** tab controls which messaging channels your agent is
deployed on. An agent with no channels won't receive anything — it shows
as "Active · No channels" in the header.

## How it works

Each channel is a toggle. When ON, the agent responds to inbound messages
on that channel through your connected CRM.

- **SMS** — text messages via GoHighLevel
- **WhatsApp** — WhatsApp Business via GHL
- **Facebook Messenger** — page DMs
- **Instagram DMs** — Instagram inbox
- **Google Business** — Google Business Profile messages
- **Live Chat** — your website chat widget
- **Email** — email conversations via GHL

## Voice is separate

Voice calls are configured on the **Voice** tab, not here. Voice needs its
own phone number, voice settings, and call-specific behaviour — it doesn't
share state with messaging channels.

## When you'd want multiple agents

If you have very different conversations per channel (e.g. SMS is about
booking, live chat is about technical support), run **separate agents per
channel** rather than one agent everywhere. Use the [Deploy rules](/help/a/deploy-rules)
tab to route the right inbound to the right agent.

## Agent status decoder

The header shows one of three states:

- **Live** — active and deployed on at least one channel
- **Active · No channels** — running but nothing points at it
- **Paused** — you clicked Pause or hit a stop condition`,
  },

  {
    slug: 'knowledge',
    title: 'Knowledge base',
    summary: 'Give the agent things it needs to know — pricing, FAQs, policies, a full website crawl.',
    order: 30,
    body: `The Knowledge tab is where you add context the agent draws on during
conversations. Think of it as the set of documents a new team member would
skim on their first day.

## Three ways to add knowledge

1. **Write it yourself** — paste a title + markdown body. Great for
   pricing sheets, FAQ lists, one-liner policies.
2. **Upload a file** — PDF, DOCX, or TXT. We extract the text and chunk it.
3. **Crawl a website** — enter a URL, we fetch the page + its links. Set up
   a recurring crawl to keep it fresh.

## How the agent uses it

On every inbound message, we search the knowledge base for chunks
semantically related to what the contact just said, and attach the top
matches to the agent's context. It's not "read everything always" — the
agent gets what's relevant to *this* turn.

## What to put in

**Good candidates:**
- Pricing, packages, service menus
- FAQ — common questions with authoritative answers
- Business hours, location, contact info (beyond what's on the website)
- Policies — cancellations, refunds, deposits
- Product specs, SKUs, features

**Bad candidates:**
- Huge marketing pages (high token cost, low signal)
- Blog posts unless they answer FAQs
- Internal operations docs the agent shouldn't reveal

## Recurring crawls

For pages that change (pricing, availability), schedule a recurring crawl —
daily or weekly. We only re-index when content has actually changed, so
your token bill doesn't climb for pages that stay still.

## Deletion

Remove a knowledge entry and it stops being used immediately. There's no
caching — next inbound message, it's gone from the agent's context.`,
  },

  {
    slug: 'deploy-rules',
    title: 'Deploy rules: when the agent runs',
    summary: 'Decide which conversations this agent picks up. Build AND/OR queries across tags, stages, keywords.',
    order: 40,
    body: `The **Deploy** tab defines *when* this agent runs on an inbound message.
Think of it as the door policy — who gets let in.

## The mental model

- Every workspace can have multiple agents
- When an inbound message arrives, we evaluate each agent's deploy rules
  **in priority order**
- The first agent whose rules match catches the message
- If no agent matches, the message goes unanswered (intentional — better than
  the wrong agent replying)

## Rule shape

Each rule is a list of **conditions** joined by **AND** (all must match).
Within each condition, you can list multiple **values** joined by **OR**
(any one matches).

**Example — one rule, two conditions:**

\`\`\`
ALL inbound messages
AND
Contact has tag in [hot-lead, vip]
\`\`\`

Reads as: *"Run this agent on any inbound message from a contact tagged
\`hot-lead\` or \`vip\`."*

## Condition types

- **All inbound messages** — catch-all, matches everything
- **Contact has tag** — picks from your GHL tags (multi-select)
- **Contact in pipeline stage** — pipeline stage ID (multi-value)
- **Message contains keyword** — simple keyword match against the inbound

## Priority order

Rules are evaluated lowest-priority number first. By convention:
- Very specific rules → priority 10–50
- Catch-all fallback → priority 999

This way your "hot-lead" agent catches its contacts before the generic
agent scoops them up.

## Design tips

- **Keep rules layered.** One specific rule per segment, one catch-all.
- **Avoid overlap.** If two agents could both match, the first wins. Test
  with the Routing Diagnostic tool (in the left sidebar) if you're unsure.
- **Between rules is OR.** Rule 1 fires OR rule 2 fires OR … — not AND.
  Use multiple rules to say "any of these scenarios is fine".`,
  },

  {
    slug: 'rules-vs-listening',
    title: 'Rules vs Listening: what goes where',
    summary: 'Rules write a known value to a known field. Listening takes free-text notes. Learn when to use each.',
    order: 50,
    body: `Rules and Listening do superficially similar things — both detect
something the contact said and act on it — but they serve different jobs.
Knowing which to reach for saves you from forcing square pegs into round
holes.

## Rules: you know *what* you want and *where* to put it

The agent is a matching engine. You've already decided the field and the value.

**Example**

- Contact says: *"I'm out of town this week"*
- Rule fires: set \`custom.out_of_town\` = \`Yes\`
- The rule definition knows:
  - The field (\`custom.out_of_town\`)
  - The value (\`Yes\`)
  - Which phrases count as a match (examples)

**Data lives in**: your CRM (GHL contact field). Visible to anyone who
opens the contact in GHL.

**You author this when**: you have a structured field you want populated.
The value is predictable — it's going to be \`Yes\`, \`Buyer\`, \`Tier 3\`, etc.

See the full [Rules guide](/help/a/rules).

## Listening: you know *what kind of thing* to remember

The agent is a note-taker. You've named a category of interest. The agent
writes the content in its own words.

**Example**

- Contact says: *"My mum is sick, I've been a bit distracted"*
- Listening rule fires: category \`Family context\`
- The agent writes a note: *"Mother is unwell — contact is distracted this week"*
- The rule definition only knows:
  - The category name (\`Family context\`)
  - Roughly what fits (description + examples)
  - It does NOT know in advance what the note will say

**Data lives in**: the agent's private memory for that contact. NOT pushed
to GHL. Shown back to the agent on future turns as "what you already know
about this contact" so it behaves like a human rep who remembers.

**You author this when**: the valuable info is unpredictable and
contextual — family events, hobbies, objections, quirks, running jokes.

See the full [Listening guide](/help/a/listening).

## Side-by-side

| | **Rules** | **Listening** |
|---|---|---|
| User pre-defines the output? | Yes — field + value | No — agent writes content |
| Where info lands | CRM contact field | Agent's private memory |
| Visible in GHL? | Yes | No |
| Shape | Structured | Free-text note |
| Classic trigger | *"I'm out of town"* | *"My mum is sick"* |

## Rough heuristic

- If the value belongs on a **form** you'd ask someone to fill in → **Rules**
- If the value belongs in a **sticky note** a sales rep would stick to the
  contact's record → **Listening**

## Why both exist

Rules can't handle "mum is sick" cleanly — you'd need a custom field called
\`family_situation\` with a value like \`Parent illness\`, and you'd be trying
to classify real human detail into a fixed taxonomy.

Listening can't handle "out of town" — you want \`custom.out_of_town = Yes\`
specifically so your automations, tags, and workflows can trigger off that
exact boolean. Free-text in a memory note can't drive a workflow.

Use both.`,
  },

  {
    slug: 'rules',
    title: 'Rules: IF the contact says X, THEN do Y',
    summary: 'Passive detection rules that run CRM actions — update fields, add tags, enroll in workflows, change opportunities, mark DND — based on what the contact says.',
    order: 60,
    body: `Rules let you teach the agent to detect things in conversation and take
automatic action. The agent evaluates every inbound message against every
active rule.

## Anatomy of a rule

Each rule has four parts:

1. **Name** — a short label so you can find it later (e.g. "Out of town")
2. **When the contact…** — a plain-English description of the condition
3. **Example phrases** — real phrases from your audience that should match
4. **Then…** — the action that fires when the rule matches

## Actions (the THEN)

The action picker covers every CRM action the agent can take based on
conversation. Each one has its own parameter panel below the picker:

- **Update contact field** — write a value to a standard or custom field.
  Gets the "keep first / always update" toggle.
- **Add tag(s) to contact** — apply one or more tags
- **Remove tag(s) from contact** — strip tags
- **Enrol contact in workflow(s)** — add to one or more published GHL
  workflows (multi-select, same picker as the Tools tab)
- **Remove contact from workflow(s)** — opposite
- **Change opportunity status** — won / lost / abandoned / open
- **Set opportunity value** — update the monetary value
- **Mark contact as Do Not Disturb** — block the current conversation
  channel, or pick a specific one

## Example: update a field

| Field | Value |
|---|---|
| Name | Out of Town |
| When the contact… | indicates they are out of town, traveling, away, or otherwise unreachable |
| Example phrases | \`im out of town\`, \`im away sorry\`, \`back next week\` |
| Then | Update field \`custom.out_of_town\` → \`Yes\`, keep first |

## Example: enrol in a workflow

| Field | Value |
|---|---|
| Name | Interested in Service X |
| When the contact… | asks about Service X pricing, shows interest in booking Service X |
| Example phrases | \`how much for Service X\`, \`can I book Service X\`, \`what's your Service X package\` |
| Then | Enrol in workflow: "Service X nurture" |

## How the agent matches

The condition is evaluated **semantically**, not by keyword match. It
handles paraphrases, typos, and indirect answers. The example phrases are
illustrative, not exhaustive — give 3–5 good ones and the agent generalises.

## Tools auto-enable

When you author a rule with an action (e.g. enrol in workflow), the
underlying tool (\`add_to_workflow\`) is enabled on the agent
automatically — you don't need to go to the Tools tab and toggle it
separately. Authoring the rule is consent.

## Overwrite semantics (update_contact_field only)

Two modes when the action is "Update contact field":

- **Keep first** (default) — only set the field if it's currently empty.
  Good for "first answer wins" signals like \`buy_or_rent = Buyer\`.
- **Always update** — overwrite every time the rule fires. Good for state
  that changes (out-of-town, next_available_date).

## When to use Rules vs [Listening](/help/a/listening)

- **Rules** = structured CRM action. You know what should happen.
- **Listening** = free-text note to agent memory. Info is too variable for
  a fixed field.

The full comparison lives in [Rules vs Listening](/help/a/rules-vs-listening).

## Common patterns to build first

- Out-of-town → update \`out_of_town\` field
- Interested in Service X → enrol in "Service X nurture" workflow
- Asks to unsubscribe / stop → mark DND on channel + remove from nurture workflow
- Budget confirmed ≥ $N → set opportunity value
- "No longer interested" → mark opportunity as Lost + add \`cold\` tag`,
  },

  {
    slug: 'listening',
    title: 'Listening: categories the agent remembers',
    summary: 'Teach the agent to keep private notes about contacts without asking, and reference them in future chats.',
    order: 70,
    body: `Listening lets you name categories of context the agent watches for
*without asking*. When the contact volunteers something that fits, the
agent writes a short note in its own words to the contact's memory.

## How it's different from Rules

Rules write a known value to a known field. Listening captures free-text
context the user couldn't have anticipated. Read
[Rules vs Listening](/help/a/rules-vs-listening) for the full comparison.

## Anatomy of a listening category

1. **Category name** — a short label (e.g. "Family context", "Pain points")
2. **Listen for** — a plain-English description of the kind of thing this
   category covers
3. **Example phrases** — real phrases to help the agent generalise

That's it. No field, no value — the agent decides what to write.

## Example

| Field | Value |
|---|---|
| Category name | Family context |
| Listen for | family members, health issues, life events |
| Example phrases | \`my mum is sick\`, \`just got engaged\`, \`dealing with a lot at home\` |

When a contact says *"my mum had a heart attack last week"*, the agent
writes a note: *"Mother recently had a heart attack — contact dealing with
family health issue."*

## What happens to the note

It's stored in the agent's private memory for that contact. On every
future conversation with this contact (on any channel), the agent sees:

\`\`\`
## What You Already Know About This Contact

- Family context: Mother recently had a heart attack — contact dealing with family health issue.
- Pain points: Budget is tight; mentioned avoiding anything above $500.
\`\`\`

The agent then uses it naturally — not by quoting it, but by softening
tone, remembering to check in, avoiding tone-deaf recommendations.

## Where the note is NOT

It's **not** pushed to GHL. It's not on the contact record. It's not in a
field any automation can read. This is deliberate — this info is the
agent's private notebook, not structured CRM data.

## Good categories

- **Family context** — spouses, kids, parents, life events
- **Pain points** — frustrations with current solution, specific objections
- **Preferences** — morning vs evening, phone vs text, direct vs friendly
- **Deal context** — timing pressure, stakeholders, competing options
- **Personal touchpoints** — pets, hobbies, sports teams, holidays

## Less-good categories

- Anything you'd want a workflow to fire on → use Rules + a field
- Anything that belongs on a form → use Qualifying questions`,
  },

  {
    slug: 'tools',
    title: 'Tools: what the agent can do',
    summary: 'The verbs available to the agent — send messages, book appointments, tag contacts, enroll in workflows, hand off to humans.',
    order: 80,
    body: `The **Tools** tab is where you pick which actions the agent is allowed to
take. Each tool is a verb the agent can call during a conversation.

## Categories

**Messaging**
- \`send_reply\` — reply on the current channel
- \`send_email\` — send an email (separate from chat reply)
- \`send_sms\` — legacy SMS (most agents use \`send_reply\` instead)

**Contacts**
- \`get_contact_details\` — look up the contact
- \`update_contact_tags\` — add tags
- \`remove_contact_tags\` — remove tags
- \`update_contact_field\` — set a standard or custom field
- \`find_contact_by_email_or_phone\` — dedupe check
- \`upsert_contact\` — create or update
- \`create_task\` — assign a follow-up task to a team member
- \`add_contact_note\` — log internal context

**Calendar / Booking**
- \`get_available_slots\` — check availability
- \`book_appointment\` — commit a booking
- \`cancel_appointment\` / \`reschedule_appointment\`
- \`create_appointment_note\` — log context onto the appointment

**Automation**
- \`add_to_workflow\` / \`remove_from_workflow\` — GHL workflow enrollment
- \`cancel_scheduled_message\` — cancel a queued SMS/email

**Pipeline**
- \`get_opportunities\` / \`upsert_opportunity\`
- \`move_opportunity_stage\`
- \`mark_opportunity_won\` / \`mark_opportunity_lost\`
- \`list_pipelines\`

**Intelligence / flow**
- \`transfer_to_human\` — [hand off](/help/a/human-handover-notifications)
- \`schedule_followup\` — queue a future message
- \`score_lead\`, \`detect_sentiment\`
- \`save_qualifying_answer\` — fires automatically as [qualifying questions](/help/a/qualifying) get answered

## Workflow tools

Enable \`add_to_workflow\` / \`remove_from_workflow\` to allow the agent to
enrol contacts in (or remove them from) GHL workflows. The specific
workflow to use is picked per-rule on the [Rules tab](/help/a/rules) —
that's where you say "when the contact asks about Service X, enrol them
in the Service X nurture". The toggle here just grants the capability.

The same applies to any rule-driven action: \`update_contact_tags\`,
\`opportunity_status\`, \`dnd_channel\`, etc. Rules author the specific
action; the Tools tab is consent that the tool exists.

## Calendar setup

Turning on \`get_available_slots\` or \`book_appointment\` auto-enables the
full booking tool set (cancel, reschedule, get_calendar_events, create_appointment_note).
You'll also need to pick a **Connected Calendar** in the panel that
appears — without it, booking tools fail silently.

Use the **Test calendar connection** button to verify: it runs a series of
checks (token valid, scope present, calendar readable, team-member
assignment working) and shows you exactly what's wrong if anything is.

## Design principle

**Only enable tools the agent should actually use.** Every enabled tool
adds to the agent's schema, which slightly dilutes focus. An agent with 8
focused tools will outperform an agent with 25 generic ones every time.`,
  },

  {
    slug: 'qualifying',
    title: 'Qualifying questions: what to ask, what to do with the answer',
    summary: 'Scripted questions the agent asks to fill contact fields, plus conditional actions when specific answers land.',
    order: 90,
    body: `Qualifying questions are the agent's scripted intake. Each one asks for a
piece of information, saves the answer to a contact field, and can
optionally fire an action based on how the contact responds.

## The question

Four answer types:
- **Text** — free-form
- **Yes / No** — boolean
- **Number** — numeric
- **Multiple Choice** — pick from options you define

You can save the answer directly to a contact field (standard or custom).
The **Keep first / Always update** toggle controls overwrite semantics —
same as [Rules](/help/a/rules).

## Asking style

Two modes, set per agent:

- **Strict** — the agent MUST ask every required question before anything
  else. Good for tight funnels where you need data upfront.
- **Natural** — the agent weaves questions into the conversation as
  opportunities arise. Good for consultative sales.

## Conditional Action (the fun part)

Each question can trigger an action based on the answer. The condition
operators:

- **is anything** — always trigger
- **is yes** / **is no** — for yes/no questions
- **contains** / **equals** — for text answers
- **is greater than** / **less than** — for numeric answers
- **is any of…** — for multi-choice, pick which specific options trigger

Available actions:

- **Continue conversation** — proceed as normal
- **Tag contact with** — add a tag
- **Move to pipeline stage** — progress the opportunity
- **Proceed to book appointment** — the agent starts the booking flow
- **Stop & hand off to human** — [fires the handover](/help/a/human-handover-notifications)
- **Add contact to workflow(s)** — enroll in GHL workflows (multi-select)
- **Remove contact from workflow(s)**
- **Change opportunity status** — won / lost / abandoned / open
- **Set opportunity value** — update monetary value
- **Mark contact DND on this channel** — block this channel

## Example

| | |
|---|---|
| Question | "Are you looking to buy or sell?" |
| Answer Type | Multiple Choice |
| Options | Buy, Sell, Both, Just browsing |
| Save to field | \`custom.intent\` |
| If answer is any of | \`Just browsing\` |
| Then | Mark contact DND on this channel |

## Tips

- **Ask one question at a time.** The agent knows not to stack them, but
  your prompts should still be scoped to one ask.
- **Pre-populate when you can.** If the answer is already on the contact
  record, the agent skips asking.
- **Don't ask 20 questions.** Every required question is a gate the
  contact has to pass. 3–5 really useful ones beats 12 mediocre ones.`,
  },

  {
    slug: 'persona',
    title: 'Persona: how the agent sounds',
    summary: 'Voice, tone, response length, emoji use, language, typing behaviour. The personality layer.',
    order: 100,
    body: `The **Persona** tab shapes *how* the agent communicates — not *what* it
does. Same system prompt + different persona = wildly different feel.

## Fields

**Agent Persona Name** — the name the agent uses when introducing itself.
Leave blank if you don't want it to use a specific name.

**Response Length**
- **Brief** — one sentence max. Good for SMS.
- **Moderate** — 1–3 sentences. Good default for most chat/messaging.
- **Detailed** — full context when needed. Good for email or complex support.

**Formality Level**
- **Casual** — contractions, friendly, relaxed
- **Neutral** — professional but approachable
- **Formal** — strict professional tone

**Use Emojis** — allows occasional (not constant) emoji use.

**Simulate Typos** — adds subtle typos to humanise SMS-style channels. Off
by default; turn on if you want the agent to feel less robotic.

**Typing Delay** — when enabled, the agent waits a random delay (within
your min/max) before sending each message, simulating human typing speed.
Good for chat widgets; overkill for email.

**Languages** — which languages the agent can respond in. The agent
detects the inbound language and matches.

**Never Say List** — words or phrases the agent must not use. Great for
compliance: "guarantee", "cure", "best", "free" — whatever trips your
legal or marketing style guide.

## How personas compose with the system prompt

The system prompt says WHAT the agent does. The persona says HOW. They're
independent — you can swap one without touching the other.

If you're running multiple agents across channels, persona is usually
where they differ most:
- SMS agent → Brief + Casual + Emojis OFF
- Live chat agent → Moderate + Casual + Emojis ON + Typing delay ON
- Email agent → Detailed + Neutral + Emojis OFF

## Tips

- **Don't stack "Brief + Formal + No emoji" on a chat widget.** That reads
  as cold. Match the persona to the channel's native register.
- **Never Say List > Behavioural Instructions for single phrases.** Easier
  to maintain and the agent respects it more reliably.
- Use the Playground to audition persona changes before shipping.`,
  },

  {
    slug: 'objectives-wins',
    title: 'Objectives: what a "win" looks like',
    summary: 'Define the outcomes that matter so the agent can push toward them — and so you can measure success.',
    order: 110,
    body: `The **Objectives** tab (sometimes labelled "Wins") defines what success
looks like for this agent. It serves two purposes:

1. **Shapes the agent** — the objectives are injected into the agent's
   context so it naturally nudges toward them.
2. **Measures the agent** — lets Voxility attribute wins to specific
   conversations in Performance and Insights.

## Anatomy of an objective

Each one has:

- **Name** — short label (e.g. "Booked consultation")
- **Description** — what counts as a win
- **Detection** — how the agent knows it happened (a tool call, a phrase, a
  tag, an opportunity status change)

## Example objectives

- **Booked consultation** → fires when \`book_appointment\` is called
- **Hot-lead qualified** → fires when \`custom.lead_score > 7\`
- **Pricing question answered** → fires when the agent quoted pricing AND
  the contact replied positively
- **Referred to partner** → fires when specific tag is applied

## How the agent uses them

Your objectives are rendered into the system prompt as "the wins you care
about". The agent reads them on every turn and steers the conversation.
It's softer than a hard rule — the agent won't force a booking if it's
inappropriate — but it measurably increases conversion for well-written
objectives.

## Measuring

Objectives are the scorecard the Insights, Performance, and Wins
dashboards all use. Every objective achieved is logged with the
conversation that produced it, so you can see:

- Objectives per day / week
- Conversion rate per agent
- Which conversations achieved which wins

## Tips

- **2–5 objectives per agent.** More than that dilutes focus.
- **Make them measurable.** "Build rapport" is fuzzy; "collected email
  address" is concrete.
- **Order matters.** The first objective listed is treated as the primary
  goal — the agent optimises for it when two objectives conflict.`,
  },

  {
    slug: 'stop-conditions',
    title: 'Stop conditions: when the agent should stand down',
    summary: 'Define the moments where the agent should pause itself — booking made, keyword said, message count hit.',
    order: 120,
    body: `Stop conditions define when the agent should pause itself on a specific
conversation. Different from **transfer_to_human** (which the agent calls
itself when stuck) — stop conditions are *your* rules for when the agent
should stop even if it thinks it's doing fine.

## Why you'd want this

- **Don't double-handle after booking.** Agent booked the meeting — stop
  pinging the contact.
- **Human takes over after a specific keyword.** e.g. "manager" or
  "attorney" — the contact has asked for a human, don't keep talking.
- **Message limit.** After 15 turns, if no booking, escalate to a human
  rep. Protects against runaway agent loops.
- **Pipeline stage change.** Deal moved to "negotiation" — humans own it
  from here.

## Condition types

- **Appointment booked** — fires when \`book_appointment\` succeeds
- **Keyword** — fires when the inbound message contains any of your
  keywords (comma-separated)
- **Message count** — fires when the conversation hits N total messages
- **Opportunity stage** — fires when \`move_opportunity_stage\` runs

## What happens when one fires

1. The conversation is marked **PAUSED** — the agent won't respond to
   further inbounds on this thread
2. A **needs_attention** notification fires on your configured channels
   (Slack, Discord, email, SMS)
3. The contact is tagged (configurable) so humans can filter
4. The conversation can be **resumed** manually from the Inbox if needed

## Pause vs Transfer

- **Stop condition** → automatic pause based on your rule
- **transfer_to_human** → the agent decides it's over its head and calls
  the handover tool
- **Fallback: transfer** → the agent hits a question it can't answer and
  your fallback setting escalates it

All three fire the same [human-handover notifications](/help/a/human-handover-notifications)
so whoever's on-call gets a deep link either way.

## Tips

- **Always set a message-count stop condition.** Catches runaway loops
  cheaply. 20 is a reasonable default.
- **Keywords are layered on top of transfer_to_human.** The agent might
  miss "speak to a human" as a natural-language cue; a keyword stop is
  belt-and-braces.
- **Test with the Playground.** Fire the condition manually to make sure
  your notification subscribers get pinged as expected.`,
  },

  {
    slug: 'triggers',
    title: 'Triggers: start conversations, not just reply to them',
    summary: 'Fire a first message when a contact hits a specific event — new contact, tag added, etc.',
    order: 130,
    body: `Triggers let the agent *start* conversations, not just respond to them.
They listen for events in your CRM and kick off an outbound message.

## Event types

- **New contact created** — someone just hit your CRM for the first time
- **Tag added** — a specific tag got applied to a contact

More event types are on the roadmap (opportunity stage changed, form
submitted, etc.) — flag what you need.

## Channel

Each trigger picks which channel the agent opens on — SMS, WhatsApp,
Email, etc. The channel must be enabled on the [Channels](/help/a/channels)
tab or the message won't send.

## Message modes

**Fixed message** — a pre-written template. Supports [merge
fields](/help/a/merge-fields) so you can personalise:

\`\`\`
Hi {{contact.first_name|there}}, thanks for reaching out about {{custom.service_interest|our services}}!
Do you have time for a quick call this week?
\`\`\`

Good for: consistent openers, compliance-sensitive industries, simple
nurture sequences.

**AI-generated message** — the agent generates the first message using
the system prompt + optional extra instructions:

\`\`\`
Greet the new lead warmly, mention that you saw they filled out the form,
and ask what they're looking for. Don't quote prices.
\`\`\`

Good for: higher-value leads where a personalised open matters; scenarios
where you want the agent to pull from knowledge + persona.

## Working hours + triggers

Triggers respect [working hours](/help/a/working-hours) — if the trigger
fires outside your window, it's held until the window opens. Inbound
replies ignore working hours; triggers are outbound and DO respect them.

## Delay before send

Optional per-trigger. Useful for:
- **Lead form follow-up** — wait 2 minutes so it feels human, not bot-fast
- **Tag-added nurture** — wait 1 hour so humans have first dibs

## Design tips

- **One trigger per distinct outbound scenario.** Don't try to make one
  trigger handle three different events.
- **Start fixed, upgrade to AI-generated.** Fixed openers are predictable
  and easy to QA. Switch to AI mode once you trust the agent's voice.
- **Watch for trigger storms.** If you mass-upload 5000 contacts with a
  trigger tag, the agent will try to text all 5000. Stagger uploads.`,
  },

  {
    slug: 'follow-ups',
    title: 'Follow-ups: nudging quiet contacts',
    summary: 'Multi-step automated nudges when a contact goes silent, says a keyword, or the agent decides it\'s time.',
    order: 140,
    body: `Follow-up sequences keep a contact warm when the conversation has stalled.
Unlike [Triggers](/help/a/triggers) (which *start* conversations),
follow-ups *continue* them.

## Trigger types

**No reply** — contact went silent. Fires after the delay on each step
from the contact's last message.

**Keyword detected** — contact said something that triggers the sequence.
\`follow up\`, \`call me back\`, \`not now\` — classic lay-low signals.

**Agent decides** — the agent itself calls the \`schedule_followup\` tool
when it judges it's time. Gives the agent full discretion.

**After every exchange** — starts a fresh sequence each time the contact
messages. Rare, but useful for aggressive re-engagement flows.

## Sequence shape

Each sequence is a list of **steps**. Each step has:

- **Step number** — order
- **Delay** — how long after the previous step (or after the trigger, for
  step 1) to wait
- **Message** — the text to send. Supports [merge
  fields](/help/a/merge-fields).

Example 3-step no-reply sequence:

| Step | Delay | Message |
|---|---|---|
| 1 | 24 hrs | Hey {{contact.first_name|there}} — just checking back in. Still interested? |
| 2 | 72 hrs | Following up once more {{contact.first_name|—}} want me to send more info, or shall I close the loop? |
| 3 | 7 days | I'll stop the messages here. If the timing's better later, just reply. |

## Working hours + follow-ups

Follow-ups respect [working hours](/help/a/working-hours). If step 2 is
scheduled for 3am, we push it to 9am (or whenever your window opens).

## What stops a sequence

- **Contact replies.** Any inbound cancels the remainder of the sequence —
  you don't want to send step 3 after they've booked a meeting.
- **Stop condition fires.** Agent paused → follow-ups paused.
- **Contact marked DND.** No more outbound.
- **Sequence finishes.** All steps sent.

## Cancellation via AI

The agent can call \`cancel_scheduled_message\` if it decides a queued
follow-up no longer makes sense (e.g. the contact said "please stop
messaging me" but it doesn't quite match your sequence's stop keywords).

## Tips

- **Start with 2–3 steps.** Long sequences feel spammy.
- **Escalate urgency gently.** Don't jump from "hi" to "last chance" on
  step 2.
- **Use merge fields.** A first-name + context line is much less
  robotic-feeling than a generic "Following up."
- **Test from the Playground.** The sequence UI lets you "fire now" for
  any step to verify copy before it goes out.`,
  },

  {
    slug: 'voice',
    title: 'Voice: phone-call agents',
    summary: 'Real-time voice agents that answer inbound calls, speak naturally, and book appointments.',
    order: 150,
    body: `The **Voice** tab turns your agent into a phone-answering voice agent.
Inbound calls route to the phone number you provision, the agent answers
in a voice you picked, and it can handle the full conversation — bookings
and all.

## Getting started

1. **Provision a phone number.** Click **+ Get a number**, optionally with
   an area code preference. We buy the number through Vapi and attach it
   to this agent. US numbers only at the moment.
2. **Pick a voice.** Browse 11labs voices, preview them, pick one. Common
   picks: Sarah (friendly American female), Adam (neutral American male),
   Rachel (clear, broadcaster feel).
3. **Tune it.** Four sliders:
   - **Speed** — 0.5x to 2.0x. Most voices feel natural at 1.0.
   - **Stability** — higher = more consistent, lower = more expressive
   - **Clarity + Similarity** — higher = closer to original voice
   - **Style Exaggeration** — amplifies the voice's character
4. **Write the opening + closing.** Supports [merge
   fields](/help/a/merge-fields):
   \`\`\`
   Hi {{contact.first_name|there}}, thanks for calling. What can I help with?
   \`\`\`
5. **Enable voice.** Toggle the agent on.

## How voice agents differ from chat agents

Same brain, different instructions:

- **Much shorter responses.** 1–3 sentences max — people don't listen to
  monologues on the phone.
- **No markdown, no lists.** Plain prose only.
- **Natural speech patterns.** "Uh-huh", "let me check that for you",
  brief acknowledgments.
- **Separate tool set.** Some CRM tools work the same, some are
  voice-specific (e.g. \`send_sms_followup\` sends an SMS after the call).

We inject voice-specific instructions into the system prompt automatically
— you don't need to rewrite your prompt for voice.

## Test calls

Use **Start call** in the Test Call panel to dial your agent from the
browser (mic permission required). Full transcript + volume indicator
visible during the call. Great for auditioning voice tuning changes.

## Recording + transcripts

**Record Calls** is ON by default. Recordings live on Vapi; transcripts
land in your Voxility inbox. Turn off if you're in a jurisdiction with
strict consent requirements you haven't met.

## End-call phrases

Words or phrases that, when the caller says them, gracefully end the
call. Default is empty — add common ones like \`goodbye\`, \`thanks bye\`,
\`hang up\` to avoid awkward "sorry I didn't catch that" loops at the end.

## Max Call Duration

Hard cap in minutes. 10 is a reasonable default; 30+ makes sense for
complex sales calls but costs more per call.

## Voice Tools

The voice agent automatically uses the same tools configured on the
[Tools](/help/a/tools) tab, **plus** a handful of voice-specific ones:

- \`get_available_slots\` (voice-optimised)
- \`book_appointment\` (voice-optimised)
- \`tag_contact\`
- \`send_sms_followup\` — queues a text after the call ends

## Common gotchas

- **No bookings?** Check the Tools tab — you need a connected calendar
  AND booking tools enabled. The test-call panel flags this.
- **Voice sounds robotic?** Lower stability to 0.3–0.4 for more expression.
- **Agent talks over the caller?** Turn endCallPhrases off or lengthen the
  max duration — it may be ending calls too eagerly.`,
  },

  {
    slug: 'working-hours',
    title: 'Working hours: when the agent is allowed to reach out',
    summary: 'Define the time window when the agent can send proactive messages. Inbound replies always send.',
    order: 160,
    body: `Working hours define when the agent is allowed to send **proactive**
messages. Inbound replies always send — if a contact messages you at 3am,
the agent replies at 3am.

## What working hours control

- **Triggers** — respect the window. A trigger that fires outside hours is
  held until the window opens.
- **Follow-ups** — respect the window. Step scheduled for 3am → pushed to
  9am (or whenever you open).
- **Agent-initiated follow-ups** (\`schedule_followup\`) — respect the window.

## What they don't control

- **Inbound replies.** If a contact messages, the agent replies. Full stop.
- **Manual sends from the Inbox.** You clicking send is your decision.
- **Handover notifications.** Notifications to you are always real-time.

## Fields

- **Enabled** — turn the whole thing on/off
- **Start hour / End hour** — 0–24, in the agent's configured timezone
- **Working days** — tick the days the agent is active
- **Timezone** — IANA timezone string (e.g. \`America/New_York\`). All
  times above are interpreted in this zone.

## Example configurations

**B2B agent, US East Coast business hours:**
- Start 9, End 18, Mon–Fri, \`America/New_York\`

**Global consumer agent, near-24/7 but quiet overnight:**
- Start 7, End 22, Mon–Sun, contact's local timezone (coming soon)

**Aggressive sales agent, always on:**
- Disabled entirely — treat every minute as fair game

## Design principle

**Respect the ask.** If someone opts into being contacted, they're still
asleep at 3am. The agent's window shouldn't be your window — it should be
the *contact's* window. Default to restraint; you can always loosen later.`,
  },
]
