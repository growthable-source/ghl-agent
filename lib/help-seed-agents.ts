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
3. **Open opportunities** — up to **8 most recent** live inquiries
   (anything not won/lost/abandoned) from the last **~6 months**.
   The section header includes the **subtotal** of every open
   opportunity's monetary value so the agent sees revenue still in
   play at a glance. Each line shows the name, price in USD, current
   pipeline stage, and any custom fields on that opportunity
   (\`vehicle_color=red\`, \`vehicle_miles=42000\`, etc.).
4. **Won deals** — up to **5 most recent** completed sales within
   the window, with a subtotal showing captured lifetime value.
   Tells the agent "we've already earned $X from this contact" and
   prevents it from pitching things the contact already bought.
5. **Lost / abandoned** — up to **5 most recent** closed-lost or
   abandoned deals in the window, with a subtotal showing missed
   revenue. Each line says whether the status was \`lost\` (the
   contact actively passed) or \`abandoned\` (went dark), so the
   agent treats a re-pitch appropriately.

If any bucket has more opportunities than fit in its slice, the
agent is told the exact number that were dropped and that it can call
\`get_opportunities\` for anything it can't see directly.

## What it looks like on a real turn

To make this concrete — here's the exact block that gets injected
into the system prompt for an Advanced agent at a used car dealer,
where the contact has three live inquiries, one closed sale earlier
this year, and one deal they passed on:

\`\`\`
## Business Context
We are a used car dealership. Each opportunity is a specific vehicle
the contact has inquired about. monetaryValue is the listed sale
price in USD. Custom fields starting with vehicle_ describe the car…

## Contact Context
### Custom fields
- budget_cap: 40000
- preferred_body_style: Truck

### Open opportunities — 3 live inquiries, $132,000 still in play
1. 2019 Ford F-150 4x4 — $45,000 — stage: test_drive_scheduled
   vehicle_color=red, vehicle_year=2019, vehicle_miles=42000
2. 2021 Toyota RAV4 LE — $35,000 — stage: interested
   vehicle_color=silver, vehicle_year=2021, vehicle_miles=18000
3. 2020 Ford F-250 — $52,000 — stage: new
   vehicle_color=white, vehicle_year=2020, vehicle_miles=60000

### Won deals — 1 closed in last 6 months, $18,500 captured
1. 2015 Hyundai Accent — $18,500 — sold 2025-12-04
   vehicle_color=blue, vehicle_year=2015, vehicle_miles=95000

### Lost / abandoned — 1 in last 6 months, $22,000 missed
1. 2018 Honda Accord — $22,000 — lost 2025-11-12
\`\`\`

The three-bucket split gives the agent explicit revenue context:

- **$132,000 still in play** — pipeline the agent can move forward
- **$18,500 captured** — don't re-offer what they already own, but
  it's useful for "how's the Accent treating you?" small talk
- **$22,000 missed** — the Accord is off the table, don't pitch it
  again; use it as a signal about their taste

With that visible on every turn, the agent can write things like
*"The F-150 is $5k over your budget — want me to pull some trucks
under $40k to compare?"* or *"I see the Accord wasn't the right fit
last month — is size what pushed you toward trucks?"* without
calling a tool.

## Using merge fields against this data

[Merge fields](/help/a/merge-fields) give you \`{{token|fallback}}\`
placeholders for pre-written templates (fixed-mode trigger messages,
follow-up steps, voice openers, fallback replies). Contact-level data
in the Advanced context is available as merge tokens:

- \`{{contact.first_name|there}}\` — the contact's first name
- \`{{custom.budget_cap|your budget}}\` — contact custom field
- \`{{custom.preferred_body_style|something nice}}\` — another one

So a fixed-mode trigger message authored as:

\`\`\`
Hi {{contact.first_name|there}}, we've got new {{custom.preferred_body_style|vehicles}}
under {{custom.budget_cap|your budget}} that just landed on the lot. Want to
take a look this week?
\`\`\`

...renders for the contact above as:

\`\`\`
Hi Jamie, we've got new Truck under 40000 that just landed on the
lot. Want to take a look this week?
\`\`\`

Note the fallbacks — \`|there\`, \`|your budget\`,
\`|vehicles\` — kick in for contacts where those fields are empty, so
the same template still reads naturally for a brand-new lead who
hasn't had their budget captured yet.

## Merge fields inside the glossary itself

The Business Context glossary **also runs through the merge-field
renderer** before it's handed to the LLM. So you can personalise the
glossary per contact, not just pre-written messages:

\`\`\`
You are speaking with {{contact.first_name|the contact}}. Their budget
is {{custom.budget_cap|not disclosed}} and their assigned salesperson
is {{user.name|our team}} ({{user.phone|call the showroom}}).

We are a used car dealership. Each opportunity is a specific vehicle
the contact has inquired about. monetaryValue is the listed sale
price in USD…
\`\`\`

At runtime the agent sees resolved values: *"You are speaking with
Jamie. Their budget is 40000 and their assigned salesperson is Alex
Chen (+1 415 555 0100)."* The same token syntax you use in trigger
messages works inside the glossary.

Tokens available in the glossary:

- \`{{contact.first_name|fallback}}\` and all [contact tokens](/help/a/merge-fields)
- \`{{custom.<fieldKey>|fallback}}\` for contact custom fields
- \`{{user.name|fallback}}\`, \`{{user.email}}\`, \`{{user.phone}}\` —
  the contact's assigned team member
- \`{{date.today}}\` / \`{{date.tomorrow}}\`

Click any **Start from an example** chip in the Business Context
editor to load a starter glossary that uses merge fields and
fallbacks — easiest way to see the pattern is to pick one closest to
your industry and edit from there.

## Merge fields vs opportunity details — an important distinction

**Merge fields only resolve contact-level data.** There is no
\`{{opportunity.name}}\` or \`{{custom.vehicle_color}}\` token — those
details live on opportunities, not on the contact, and there can be
many per contact. Trying to merge them makes no sense ("which one?").

Instead, **the AI references opportunities naturally** when it writes
its own reply, because it's reading the same Active inquiries section
you saw in the injected block above. If the contact texts *"is the
red one still available?"*, the agent resolves "red one" to the
F-150 by cross-referencing \`vehicle_color=red\`, and writes back
conversationally. You don't template that — you just rely on the
agent seeing the data.

**Rule of thumb:**

- Pre-written template with a single contact in front of it → use
  merge fields against contact-level data
- AI-generated reply that references *specific* cars / deals / rooms
  / properties the contact is looking at → use Advanced context and
  let the agent compose freely

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
    summary: 'Decide which conversations this agent picks up. AND, OR, and NOT across tags, stages, keywords.',
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

Each rule is one or more **groups**. The boolean logic is:

- **Within a group → AND.** Every condition in the group must match.
- **Between groups → OR.** Any one group matching is enough.
- **Each condition → NOT (optional).** Click the NOT toggle on a condition
  to invert it (*does NOT have tag*, *NOT in pipeline stage*, etc.).
- **Within a condition → OR.** List multiple values and any one matches.

**Example — one group, two conditions:**

\`\`\`
Contact has tag in [hot-lead, vip]
AND
Contact does NOT have tag [bot, do-not-contact]
\`\`\`

Reads as: *"Run this agent for any contact tagged hot-lead or vip, as
long as they don't also have bot or do-not-contact."*

**Example — two groups (OR):**

\`\`\`
Group 1:
  Contact has tag [enterprise]
  AND Contact in pipeline stage [closing]
OR
Group 2:
  Contact has tag [high-intent]
  AND NOT Contact has tag [cold]
\`\`\`

Reads as: *"Run this agent for enterprise deals in closing stage — OR —
high-intent contacts who aren't tagged cold."*

## Condition types

- **All inbound messages** — catch-all, matches everything (doesn't
  support NOT — negating "everything" means "nothing")
- **Contact has tag** — picks from your GHL tags (multi-select, supports NOT)
- **Contact in pipeline stage** — pipeline stage ID (multi-value, supports NOT)
- **Message contains keyword** — keyword match against the inbound
  (multi-value, supports NOT)

## Priority order

Rules are evaluated lowest-priority number first. By convention:
- Very specific rules → priority 10–50
- Catch-all fallback → priority 999

This way your "hot-lead" agent catches its contacts before the generic
agent scoops them up. A rule that's purely \`ALL inbound messages\` lands
at priority 999 automatically; anything more specific (including \`ALL\`
combined with a tag filter) lands at priority 10 so it can outrank a
plain catch-all.

## Design tips

- **Keep rules layered.** One specific rule per segment, one catch-all.
- **Avoid overlap.** If two agents could both match, the first wins by
  priority. Test with the Routing Diagnostic tool (in the left sidebar)
  if you're unsure which agent would catch a given contact.
- **Use NOT to carve out exceptions.** Instead of writing three separate
  rules for "VIP but not cold, VIP but not churned, VIP but not bot",
  one rule with three NOT clauses is cleaner and sorts better.
- **Use OR groups for "either of these makes sense".** A nurture agent
  for "long inactivity OR explicit re-engagement request" reads better
  as two groups than one overloaded condition set.
- **Between whole rules is still OR.** Rule 1 fires OR rule 2 fires — not
  AND. Prefer OR groups within one rule over two separate rules when the
  logic is conceptually one door policy; use separate rules when they
  truly are different scenarios with different priorities.`,
  },

  {
    slug: 'merge-fields',
    title: 'Merge fields: the {{…}} placeholders that personalise pre-written messages',
    summary: 'Drop contact data into fixed-mode triggers, follow-ups, voice openers, fallback lines, and the Advanced business-context glossary.',
    order: 45,
    body: `Merge fields let you write one message template and have it render
differently per contact. Type \`{{contact.first_name}}\` in a follow-up,
and at send time it becomes "Hi Jamie" or "Hi Alex" depending on whose
number is on the other end.

## Where they work

Anywhere you're writing a **pre-written template** — not anywhere the
AI composes its own reply.

- **Fixed-mode trigger messages** (Triggers tab, when "Fixed message"
  is selected)
- **Follow-up steps** (Follow-ups tab — each step's message body)
- **Voice opener / closer / end-of-call phrase** (Voice tab)
- **Fallback message** (Settings tab, when behaviour is "Send a
  message" or "Message then transfer")
- **Widget welcome message** (Widget config)
- **Qualifying question text** (Qualifying tab)
- **Business Context glossary** on [Advanced agents](/help/a/simple-vs-advanced-agents)
  — the glossary itself runs through the renderer, so \`{{user.name}}\`
  in your glossary resolves to the contact's assigned salesperson

The AI's own replies don't need merge fields because the agent already
sees the contact data and personalises naturally. Writing
\`{{contact.first_name}}\` in the system prompt is usually redundant.

## Syntax

\`\`\`
{{token}}                       → empty string if missing
{{token|fallback text}}         → "fallback text" if missing
\`\`\`

The token path uses dots: \`{{namespace.key}}\`. The optional \`|fallback\`
after a pipe renders in place of an empty or missing value.

**Always use a fallback on anything that might be empty.** First names,
custom fields, and calls from unknown numbers can all hit a blank.
\`{{contact.first_name|there}}\` reads naturally in both cases.

## The tokens

### Contact

- \`{{contact.first_name|fallback}}\` — first name, or extracted from
  \`name\` if no firstName
- \`{{contact.last_name|fallback}}\` — last name
- \`{{contact.full_name|fallback}}\` — whole name
- \`{{contact.email|fallback}}\` / \`{{contact.phone|fallback}}\`
- \`{{contact.company|fallback}}\` / \`{{contact.city|fallback}}\` /
  \`{{contact.state|fallback}}\` / \`{{contact.country|fallback}}\`
- \`{{contact.tags|fallback}}\` — comma-joined list

### Custom fields (contact-level only)

\`{{custom.<fieldKey>|fallback}}\` resolves against the contact's GHL
custom fields. The \`<fieldKey>\` is the stable slug from Settings →
Custom Fields (usually \`contact.your_field_name\` in GHL). The
\`{{…}} Insert value\` picker pre-populates with the real field keys
from your location so you don't have to type them.

**Note:** There's no \`{{opportunity.*}}\` or \`{{custom.vehicle_color}}\`
for opportunity-level custom fields — opportunities can be multiple per
contact (which one would merge?). See [Advanced agents](/help/a/simple-vs-advanced-agents)
for how the AI reads opportunity data directly instead.

### Agent

- \`{{agent.name|fallback}}\` — the agent's display name (or persona
  name if set)

### Assigned user (contact's CRM owner)

The team member assigned to the contact in GHL. Requires the OAuth
scope \`users.readonly\` — reconnect GHL from Integrations if the
values come back empty. Useful for "your rep is Alex at
+1 415 555 0100" style templates.

- \`{{user.name|our team}}\` — full name
- \`{{user.first_name|fallback}}\` / \`{{user.last_name|fallback}}\`
- \`{{user.email|fallback}}\`
- \`{{user.phone|fallback}}\`
- \`{{user.extension|fallback}}\`

### Date

- \`{{date.today}}\` — locale-friendly like "Saturday, November 8"
- \`{{date.tomorrow}}\` — same, next day
- Respects the agent's timezone if set (Working Hours tab)

## Worked examples

**Fixed-mode trigger message, tag-added event:**

\`\`\`
Hi {{contact.first_name|there}}, thanks for reaching out about
{{custom.service_interest|our services}}. I'm {{agent.name|from the
team}}. Quick question — what's got you looking right now?
\`\`\`

**Follow-up step, "schedule a chat":**

\`\`\`
Hey {{contact.first_name|there}}, looping back —
{{user.name|our team}} has some availability
{{date.tomorrow}}. Want me to lock in a time?
\`\`\`

**Voice call opener:**

\`\`\`
Hi {{contact.first_name|there}}, this is {{agent.name|calling from}}
about your inquiry. Got a few minutes?
\`\`\`

## The Insert-value picker

Every merge-aware textarea has a \`{{…}} Insert value\` button in the
top-right corner. Click it to get a grouped, searchable list of every
token available — built-ins, your CRM custom fields (auto-fetched),
and a link to this reference page. Typing into the search box filters
live; Enter inserts the top match at the cursor.

## How it works at send time

When a pre-written message is about to send, we:

1. Load the contact record (name, fields, tags)
2. Hydrate contact custom fields (match \`fieldKey\` to your tokens)
3. Resolve the assigned user if any \`{{user.*}}\` tokens are used
4. Substitute every \`{{token}}\` in the template
5. Send the result

If any step fails (e.g. GHL scope missing, contact deleted), the
affected tokens fall back to their \`|fallback\` value or render as
empty — the message still sends. No half-rendered templates.

## Common mistakes

- **Using tokens in AI instructions** — the agent already has the
  contact; writing \`{{contact.first_name}}\` in the system prompt is
  redundant and often gets copied into the reply literally.
- **Forgetting fallbacks** — \`"Hi {{contact.first_name}},"\` on an
  anonymous contact renders as \`"Hi ,"\` which looks broken.
  \`"Hi {{contact.first_name|there}},"\` is the fix.
- **Assuming \`{{user.*}}\` works without the scope** — if you added
  these tokens and see them coming back blank, GHL needs
  reconnecting with the \`users.readonly\` scope.
- **Using \`{{custom.*}}\` for opportunity data** — opportunity-level
  fields (vehicle color, deal stage, etc.) aren't token-resolvable.
  They're visible to [Advanced agents](/help/a/simple-vs-advanced-agents)
  but the LLM references them in its own reply; you don't template them.`,
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
    summary: 'Auto-pause on bookings, keywords, hostile sentiment, message counts. Tag needs-attention and trigger GHL workflows on the way out.',
    order: 120,
    body: `Stop conditions define when the agent should pause itself on a specific
conversation. Different from **transfer_to_human** (which the agent calls
itself when stuck) — stop conditions are *your* rules for when the agent
should stop even if it thinks it's doing fine.

## Why you'd want this

- **Don't double-handle after booking.** Agent booked the meeting — stop
  pinging the contact.
- **Pause the moment the contact gets hostile.** Angry language, legal
  threats, demands for refunds — flip the bot off before it makes things
  worse.
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
- **Pipeline stage** — fires when \`move_opportunity_stage\` runs
- **Hostile / angry sentiment** — fires when the inbound matches a
  built-in hostile-language pattern (hate, lawyer, refund now, scam,
  profanity, unacceptable, etc.) OR any extra keywords you supply.
  Deliberately broad — false positives just show up on the review
  queue, false negatives let angry contacts keep getting bot replies.

## Actions when a condition fires

Every condition carries its own action config — you can mix and match:

- **Pause agent** (default on) — stops all further replies until a
  human resumes the conversation. Turn this OFF for a *flag-only*
  rule that just raises awareness without interrupting the flow.
- **Tag \`needs-attention\`** (default on) — the contact shows up on
  the [Needs Attention review queue](/help/a/needs-attention-queue)
  for a human to pick up. The tag is searchable in GHL if you want
  custom segments built on top.
- **Enrol in workflow** (optional) — GHL workflow ID. The contact is
  added the moment the condition trips. Handy for "hostile customer
  recovery" sequences that fire automatically.
- **Remove from workflow** (optional) — GHL workflow ID. The contact
  is pulled out. Handy for yanking someone out of a nurture drip the
  moment they ask to cancel.

Workflow pickers only appear if your GHL connection includes the
\`workflows.readonly\` scope. Reconnect from Integrations if the
picker shows no options.

## Flag-only (non-pausing) patterns

You don't have to stop the agent — you can just flag a contact. Common
patterns:

- **Sentiment, flag-only:** Keep replying, but tag every hostile
  inbound \`needs-attention\` and enrol into a "support escalation"
  workflow. The bot keeps the conversation warm while a human gets
  looped in.
- **Keyword "refund", flag-only:** Tag and enrol into a finance-team
  workflow without pausing — the agent keeps going, finance gets
  looped in async.

## What happens end-to-end when a condition fires

1. The condition's **actions** run (tag, enrol, remove — each
   best-effort, one failure doesn't block the others)
2. If **Pause agent** is on, the conversation state flips to PAUSED —
   the agent won't reply to further inbounds on this thread
3. A **needs_attention** notification fires on your configured channels
   (Slack, Discord, email, SMS — see [human handover notifications](/help/a/human-handover-notifications))
4. The conversation can be **resumed** manually from the Inbox
   Needs-Attention queue once a human has picked it up

## Pause vs Transfer

- **Stop condition** → automatic pause based on your rule
- **transfer_to_human** → the agent decides it's over its head and calls
  the handover tool
- **Fallback: transfer** → the agent hits a question it can't answer and
  your fallback setting escalates it

All three fire the same [human-handover notifications](/help/a/human-handover-notifications)
so whoever's on-call gets a deep link either way.

## Tips

- **Always add a SENTIMENT condition.** The built-in pattern catches
  most hostile language; you can leave the extra-keywords field empty
  for v1. Pair with a recovery workflow and you've got a safety net
  that runs itself.
- **Always set a message-count stop condition.** Catches runaway loops
  cheaply. 20 is a reasonable default.
- **Layer keyword + sentiment.** Sentiment catches emotional tone;
  keyword catches specific phrases ("speak to manager") the agent
  might miss. Belt and braces.
- **Test with the Playground.** Fire the condition manually to make
  sure your notification subscribers get pinged and your workflows
  enrol as expected.`,
  },

  {
    slug: 'triggers',
    title: 'Triggers: start conversations, not just reply to them',
    summary: 'Fire a first message when a contact hits a specific event — new contact, tag added, etc. Edit, test-fire, delay by days/hours/minutes.',
    order: 130,
    body: `Triggers let the agent *start* conversations, not just respond to them.
They listen for events in your CRM and kick off an outbound message.

## Event types

- **New contact created** — someone just hit your CRM for the first time.
  **Fires on EVERY new contact** — form submissions, imports, API calls,
  manual adds, other workflows. The UI highlights this event in amber
  with a ⚠️ banner because operators have lit up their entire pipeline
  more than once by underestimating it. If you only want to fire for a
  specific source (a form, a paid campaign), **use Tag added instead**
  and tag contacts from your intended source.
- **Tag added** — a specific tag got applied to a contact. Much safer
  for targeted outbound — you control exactly which contacts get
  messaged by controlling which ones get the tag.

More event types are on the roadmap (opportunity stage changed, form
submitted, etc.) — flag what you need.

## Tag picker

When you pick the **Tag added** event, the tag filter field becomes a
searchable picker sourced from your GHL location's tags. Type to filter,
pick one from the dropdown, or type a new name and hit Enter / click
"Create" to create it in GHL on the spot. Requires the
\`locations/tags.readonly\` + \`locations/tags.write\` scopes on your
GHL connection — reconnect from Integrations if the picker shows
"missing scope."

## Channel

Each trigger picks which channel the agent opens on — SMS, WhatsApp,
Email, etc. The channel must be enabled on the [Channels](/help/a/channels)
tab or the message won't send.

## Message modes

**Fixed message** — a pre-written template. Supports [merge
fields](/help/a/merge-fields) so you can personalise:

\`\`\`
Hi {{contact.first_name|there}}, thanks for reaching out about
{{custom.service_interest|our services}}! {{user.first_name|I}} will
be in touch shortly.
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
where you want the agent to pull from knowledge + persona (especially
on [Advanced agents](/help/a/simple-vs-advanced-agents) where the LLM
also has the contact's opportunities in view).

## Delay before sending

The delay picker is four separate fields — **days, hours, minutes,
seconds** — so you can express human-friendly waits without doing
mental math. \`delaySeconds\` is stored under the hood; the existing
trigger list renders the total back as something readable like
\`2d 4h\` on the card.

Useful for:
- **Lead form follow-up** — wait 2 minutes so it feels human, not bot-fast
- **Tag-added nurture** — wait 1 hour so humans have first dibs
- **Overnight capture** — wait 8h so form submissions at 11pm don't
  text at 11:02pm

Working hours still apply on top — if the scheduled send-time lands
outside your window, it bumps to the next open slot.

## Editing a trigger

Every trigger card has **Edit**, **Test fire**, and **Delete** buttons.
Clicking Edit loads the trigger's values into the same form you created
it with — change the event, swap the channel, rewrite the message,
adjust the delay — then **Save Changes**. Nothing else about the agent
changes; edits are atomic to that one trigger.

## Test-firing a trigger

The **Test fire** button on each card opens a mini panel where you can
paste a contact ID, phone, or email and fire the trigger against that
specific contact. The message actually sends — use a contact you own.
The test fire path skips the 60-second per-contact dedupe so you can
re-fire repeatedly while QA'ing.

Use this to verify:
- Fixed-mode merge fields render the way you expect
- AI mode produces a sensible opener
- Tag filters actually match (test a contact with and without the tag)
- Delay handling — test-fire triggers bypass working hours, so a
  weekend test still fires

## Working hours + triggers

Real triggers respect [working hours](/help/a/working-hours) — if
the trigger fires outside your window, it's held until the window
opens. Inbound replies ignore working hours; triggers are outbound
and DO respect them. Test-fire is the exception — it fires now
regardless.

## GoHighLevel webhook subscription

Triggers listen for webhook events from your connected GHL marketplace
app. If Test Fire works but real-event triggers don't, the most common
cause is that the marketplace app isn't subscribed to the matching
event. You need both \`ContactCreate\` AND \`ContactTagUpdate\` in the
subscribed events list.

## Design tips

- **One trigger per distinct outbound scenario.** Don't try to make one
  trigger handle three different events.
- **Prefer Tag added over New Contact Created.** Unless you really do
  want to pitch *every* contact that lands in your CRM.
- **Start fixed, upgrade to AI-generated.** Fixed openers are predictable
  and easy to QA. Switch to AI mode once you trust the agent's voice.
- **Watch for trigger storms.** If you mass-upload 5000 contacts with a
  trigger tag, the agent will try to text all 5000. Stagger uploads or
  add a [stop condition](/help/a/stop-conditions) for \`do-not-contact\`.`,
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

  {
    slug: 'needs-attention-queue',
    title: 'Needs Attention: the review queue for flagged conversations',
    summary: 'One page that surfaces every conversation your agent couldn\'t handle — paused, errored, fallback-answered, stalled. Act on any row inline without leaving the page.',
    order: 170,
    body: `The **Needs Attention** page (sidebar → Needs Attention) is a single
live queue of every conversation a human should look at. It refreshes
every 30 seconds and pulls from four sources so nothing falls through
the cracks.

## Spotting items without visiting the page

The sidebar link carries a **red count badge** whenever there are
flagged items — same shape as an iOS app icon notification. Zero
means the badge is hidden; anything over 99 caps at \`99+\`. Same
treatment on the **Approvals** link if you're using the
[approval queue](/help/a/human-handover-notifications#approval_pending).
The count polls every 30 seconds from the same endpoint the page
uses, so the number on the badge is always the current queue depth.

## What shows up here

**1. Paused conversations** — anything where a [stop
condition](/help/a/stop-conditions) tripped or the agent called
\`transfer_to_human\`. The reason is shown in plain English — no
more decoding \`SENTIMENT:hostile\` or \`KEYWORD:stop\`. You see
"Hostile sentiment" with a one-line explanation of what the agent
matched on.

**2. Errored conversations** — a turn where the agent threw during
tool execution (GHL 500, rate limit, auth failure). Error text is
shown so you can fix the root cause, not just read the symptom.

**3. Fallback-answered conversations** — turns where the agent used
its fallback message because it didn't know the answer. If you see the
same fallback over and over, that's a signal to add [knowledge](/help/a/knowledge).

**4. Stalled conversations** — threads over 10 turns without a
resolution. The agent's still replying but nothing's converging; worth
a human eye.

## Actions on each row

Every paused row with an agent has three options:

- **Resume agent** (green) — hand the conversation back to the
  agent. Opens a modal where you can leave a context note the
  agent will see on its very next reply. See the
  [handoff workflow](/help/a/takeover-and-resume-handoff) for the
  full walkthrough.
- **Take over** (outline) — pause the agent under your name. Opens
  the same modal with a reason field so you capture *why* you're
  stepping in for audit trail.
- **View contact** — deep-link into the contact detail page for
  direct inbox access (the old flow).

Errored / fallback / stalled rows don't have the Resume + Take over
actions — there's no paused agent to resume or take over from. They
surface for context only, with the View contact link to dig in.

## Filters

Click any of the four summary chips (Paused / Errors / Couldn't
answer / Stalled) at the top to filter the list to that category.
Click the same chip again to clear.

## Who gets notified

A **needs_attention** notification fires on every workspace notification
channel (Slack, Discord, email, SMS — configured under
[Integrations](/help/a/human-handover-notifications)) the moment a
conversation pauses. The review queue is where you go *after* the
ping lands. The sidebar badge is the at-a-glance indicator in between.

## The \`needs-attention\` tag

[Stop conditions](/help/a/stop-conditions) that trip optionally tag
the contact with \`needs-attention\` (on by default, configurable
per condition). This is a regular GHL tag so:

- You can search for it in GHL directly
- You can build workflows that trigger on it
- You can filter reports on it
- It persists even after a human takes over — useful for retro
  analysis ("how many of our opts-out tagged needs-attention in the
  week before they unsubscribed?")

Untag manually when the issue's resolved, or bake it into a recovery
workflow that clears the tag on completion.

## Patterns for handling the queue

- **One-human-on-call.** Dedicate one person per timezone to clear the
  queue each morning. 5 minutes a day beats a 2-hour firefight weekly.
- **Route by type.** Errored conversations go to a support engineer;
  paused-for-sentiment conversations go to account managers. Use the
  needs-attention notifications to fork the signal.
- **Turn fallback spam into knowledge.** If the same question keeps
  hitting fallback, the agent's knowledge base is missing a doc.
- **Resume with a note, not a click-and-pray.** When you unpause an
  agent, use the modal's note field to tell the agent what the
  human-conducted part of the conversation covered. Otherwise the
  agent will likely re-ask questions the human already answered.`,
  },

  {
    slug: 'takeover-and-resume-handoff',
    title: 'Taking over and resuming: the handoff workflow',
    summary: 'When your agent flags a conversation, you can take over under your own name or resume the agent with a context note it reads on its next reply.',
    order: 172,
    body: `When the [Needs Attention queue](/help/a/needs-attention-queue) shows a
paused conversation, you have three choices: take it over, resume the
agent with a note, or ignore it. This article covers when to use each
and how the agent actually receives your guidance.

## Where handoffs happen

Any row on the **Needs Attention** page that represents a paused
agent (sentiment stop, keyword stop, \`transfer_to_human\` call,
manual pause, etc.) shows two buttons:

- **Resume agent** — green. Hand control back to the agent. The
  agent replies to the contact's next inbound.
- **Take over** — outline. Pause the agent under your name and
  log a takeover record. The agent stays paused until someone
  resumes it explicitly.

Both open the same modal. The modal also surfaces the **humanised
pause reason** at the top — "Hostile sentiment," "Keyword matched
(stop, unsubscribe)," "Agent asked for help," etc. — so you know
what you're deciding on before you click.

## Resume agent — the common path

Most "flagged" conversations don't actually need a human to step
in. They need a human to look at the flag, decide it's fine, and
hand it back — sometimes with context the agent should carry
forward.

**Example — hostile sentiment false positive:**

Contact texts: *"That's the worst thing I've ever heard. I love it."*

The [SENTIMENT](/help/a/stop-conditions) stop condition fires on
the word "worst." The agent pauses. You look at it, realise they
were being sarcastic, and click **Resume agent**. You type in the
modal:

> *"They're being sarcastic — they love the product. Keep going.
> No handholding needed."*

Click Resume. The agent unpauses and sees your note on its very
next reply. It continues the conversation with full context.

## Two ways to resume — wait vs send now

The Resume modal has a **"Send a follow-up message now"** checkbox.
This is the key control that decides what happens immediately
after Resume:

- **Unchecked (default) — wait for the next inbound.** The agent
  flips to ACTIVE state, your handoff note is saved to memory, but
  nothing visible happens yet. When the contact's next message
  arrives, the agent reads it + your note, then replies. Use this
  when the conversation was already paused waiting for the
  contact's response.

- **Checked — agent sends a follow-up now.** The agent composes
  an outbound message using the handoff note as context and sends
  it on the channel you pick in the dropdown. Mirrors the
  AI-generated [trigger](/help/a/triggers) flow — same prompt
  scaffolding, same working-hours guard. Use this when you need
  the agent to reach out proactively, e.g. after you finished a
  phone call with the contact and want the agent to follow up by
  SMS.

If [working hours](/help/a/working-hours) are enabled on the
agent and the current time is outside the window, the follow-up
is **skipped** (the agent is still unpaused; the note is still
saved). The modal tells you this so you can choose whether to
wait for the next window or disable working hours.

### When to leave "Send now" off

- The contact was mid-sentence when the pause fired — they'll
  reply again on their own
- You just took over for 5 minutes, you're handing back before
  the contact has noticed the pause
- You want the agent ready-but-quiet

### When to tick "Send now"

- The conversation has been idle for hours and you want momentum
- You finished a phone call with the contact and the agent
  should reinforce what you agreed on by text
- The contact never messaged back after the stop-condition hit
  and you need the agent to break the silence

## Take over — when the agent shouldn't come back alone

Use **Take over** when you want to handle this conversation
manually and not leave it up to the agent to pick up again
automatically.

**Example — angry contact threatening a lawyer:**

Contact says *"I'm going to call my attorney."* SENTIMENT fires.
You click **Take over** with the reason:

> *"Handling directly, will update when resolved."*

The conversation stays paused. You reply to the contact yourself
from the Inbox. When you're done, return to Needs Attention
(or the contact page) and click Resume agent — this time with a
note telling the agent what happened:

> *"Contact and I reached agreement on the refund. They'll wait
> 7 days for the credit to clear. Confirm receipt once they
> respond. Do not bring up the complaint again."*

The agent resumes, reads the handoff note, and picks up from the
new baseline.

## How the agent sees your note

When you resume with a note, it's stored in the contact's memory
under a category called \`handoff_context\`. That entry gets
injected into the agent's system prompt on every subsequent turn
under the heading **"What You Already Know About This Contact"**:

\`\`\`
## What You Already Know About This Contact

- handoff_context: A human just handed this conversation back to
  you. Their note: "Contact and I reached agreement on the refund.
  They'll wait 7 days for the credit to clear. Confirm receipt
  once they respond. Do not bring up the complaint again."
  Treat this as essential context for your next reply; do not
  re-open topics the human has already addressed.
\`\`\`

The agent reads this alongside your system prompt, persona, and
knowledge base on every turn. Instructions like "don't re-open the
complaint" reliably stick because the agent sees them fresh each
time.

## What makes a good handoff note

- **Summarise what the human leg of the conversation covered.**
  Not verbatim — just the outcome and any commitments made.
- **Tell the agent what NOT to do.** "Don't re-ask about their
  budget" prevents the agent from wiping your hard-won progress.
- **Note any time-sensitive commitments.** "They'll follow up in
  7 days" or "I promised a callback at 2pm Thursday" — the agent
  will honour these.
- **Don't dump customer PII you didn't get permission for.** The
  note goes into memory which is visible to anyone with access to
  this contact's record in Voxility.

## Takeover without a follow-up note

If you take over and then decide you don't want to resume the agent
at all (e.g. you converted the lead, you closed the complaint,
they're going to deal with it on their end), leave the conversation
paused. It drops off the Needs Attention queue once the
conversation stalls or the contact marks it done — nothing else
happens. The agent won't spontaneously reply.

You can also apply an opt-out tag via [rules](/help/a/rules) or
manually in GHL to permanently stop outbound to that contact.

## Finding the handoff history

Every takeover and resume writes an audit trail entry with the
operator's identity, the note they left, and the timestamp. Visible
in two places:

- **Audit log** (sidebar → Audit Log) — workspace-wide timeline
- **Contact detail page** — per-contact history with the same notes

Useful for post-mortems ("why did we drop this lead?") and for
onboarding new operators ("this is how the team handles hostile
contacts").

## Keyboard-friendly workflow

- Click **Resume agent** on the row
- Type the note (autofocus is on the textarea)
- **Enter** submits (via the form's default-submit behaviour)
- Row disappears from the queue
- Sidebar badge decrements by 1

Most handoffs should take under 15 seconds end to end.

## The badge on the sidebar

The red count next to **Needs Attention** in the left nav is the
number of rows currently on the queue. It polls every 30 seconds
and decrements when you resolve a row. If the number keeps
climbing, that's usually a sign of:

- A [stop condition](/help/a/stop-conditions) firing too
  aggressively (dial back the keyword list or the sentiment
  match)
- An agent too quick to call \`transfer_to_human\` (tighten its
  instructions so it tries harder before bailing)
- A real external change — e.g. a bad batch of leads that are all
  triggering the same fallback

Treat a rising badge as a signal to investigate, not just to
clear.`,
  },

  {
    slug: 'human-handover-notifications',
    title: 'Human handover notifications: where the pings go',
    summary: 'Configure Slack, Discord, email, and SMS destinations for agent pauses, errors, and transfer_to_human calls.',
    order: 175,
    body: `Whenever the agent pauses a conversation, calls \`transfer_to_human\`,
or errors out, we fire a notification. This article covers where those
pings go and how to wire them up.

## Four notification channels

Configure under **Settings → Integrations → Notifications**:

- **Slack** — OAuth install, channel picker, posts rich messages
  with a deep link to the conversation
- **Discord** — paste a webhook URL (Server → Integrations →
  Webhooks → New Webhook), we post embeds
- **Email** — any inbox, one or many. Best for long-tail events you
  check asynchronously
- **SMS** — a phone number that gets texted for urgent events.
  Keep this for true escalations so the noise doesn't train your
  team to ignore it

You can wire up any combination. Most operators use Slack + email
for routine, SMS for severe only.

## The events

- **\`needs_attention\`** — a conversation paused itself. Fires for:
  stop conditions tripping, fallback-with-transfer, manual agent
  pause. Links to the [Needs Attention queue](/help/a/needs-attention-queue).
- **\`human_handover\`** — the agent called \`transfer_to_human\`.
  Fires with the agent's summary of *why* (pulled from the tool
  call's reason argument), so the human picking up has context
  without reading the whole thread.
- **\`agent_error\`** — a turn errored out. Includes the error
  message so you can debug without screen-sharing.
- **\`approval_pending\`** — an outbound reply was held by the
  [approval queue](/help/a/simple-vs-advanced-agents) for human
  review. Time-sensitive — these block real outbound traffic until
  a human clicks approve.

Each event has a severity: \`info\`, \`warning\`, \`error\`. Wire
integrations to route severity accordingly (errors to an on-call
Slack channel, info to an email digest).

## Per-event subscribe

Each integration has per-event toggles so you can wire Slack for
\`needs_attention\` only, email for \`agent_error\` only, SMS just
for \`approval_pending\`. Default is "all events to all channels",
which is noisy — narrow it down after the first week.

## What's in the payload

All notifications include:

- Agent name
- Contact ID (last 6 chars shown, full in the link)
- Reason / body (truncated to ~200 chars)
- Deep link to the conversation in the Inbox
- Timestamp + severity

## Testing

Each integration has a **Send test** button on its config row. Fires
a real notification with dummy data so you can verify formatting
without waiting for an agent to pause.

## When notifications feel spammy

Two patterns:

- **Narrow subscriptions.** Don't send every event to every channel.
  Slack for \`needs_attention\`, email for everything else.
- **Tune stop conditions.** If the same stop condition fires 50 times
  a day, the condition is miscalibrated. Either loosen it (lower
  sensitivity) or handle it differently (workflow enrol instead of
  pause — see [stop conditions](/help/a/stop-conditions)).

## Privacy note

Notifications include contact IDs + short message snippets. If you're
in a regulated industry (HIPAA, PCI), prefer email+SMS to a dedicated
admin inbox over Slack/Discord — the latter are easier to accidentally
over-share.`,
  },
]
