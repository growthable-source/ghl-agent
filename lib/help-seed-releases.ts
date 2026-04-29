/**
 * Help center seed data for the "What's new" / Releases category.
 *
 * Shared with /api/help/seed-releases (admin-triggered reseed). Idempotent
 * — keyed by article slug, so editing a body here and rerunning republishes
 * that article.
 */
export const RELEASES_CATEGORY = {
  slug: 'releases',
  name: "What's new",
  description: 'Recently shipped features, with the why and the how-to for each.',
  icon: '🚀',
  order: 0,
}

export const RELEASES_ARTICLES = [
  // ───────────────────────────────────────────────────────────────────
  // Click-to-call widget
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'click-to-call-widget',
    title: 'Click-to-call buttons, inline embeds, and hosted call pages',
    summary: 'Drop a styled "Talk to us" button on any landing page, share a hosted page link anywhere, or paste a button into your email signature.',
    order: 10,
    body: `The **Widgets** menu (formerly "Chat Widgets") now hosts two widget
types: the existing chat widget and a new click-to-call button. Both ride
the same install snippet, the same allowed-domains controls, and the same
voice-agent routing.

## What you get

- **Click-to-call button** — a styled button on your site that opens a
  voice call with your agent. Floating bottom-right or inline in the page.
- **Hosted call page** — a shareable URL (\`yourdomain.com/c/your-brand\`)
  with a clean landing page. No website install required.
- **Email signature snippet** — a one-line HTML pill that links to the
  hosted page. Paste into Gmail, Outlook, or Superhuman.

## Create one

1. Go to **Widgets** → **+ New widget**
2. Pick **Click-to-call button**
3. Choose the voice agent under **Routing → Default agent**
4. Style the button (label, shape, size, icon, text colour) under **Button styling**
5. Set a slug under **Hosted call page** to enable the shareable URL + email signature

Click-to-call widgets default to having voice on, so you don't need to
toggle anything else. The voice agent inherits its system prompt and
voice config from the agent you picked in step 3.

## Embed modes

**Floating** is the default — a pinned button in the corner of the host
page (bottom-left or bottom-right).

**Inline** lets you drop the button into a specific spot on the page.
Place a target div where you want the button to appear, then point the
script at it:

\`\`\`html
<div id="voxility-call"></div>
<script src="https://yourdomain.com/widget.js"
        data-widget-id="wgt_xxx"
        data-public-key="widget_pub_xxx"
        data-mount="#voxility-call"
        async></script>
\`\`\`

The widget editor toggle ("Floating button" / "Inline (in-page)") flips
the snippet for you — copy and paste.

## Hosted call page

Enable it by setting a slug. The URL becomes \`yourdomain.com/c/<slug>\`.
This page:

- Works without an embed — just share the link
- Has its own SEO-indexable landing UI with optional headline + subtext
- Bypasses the widget's allowed-domains check (it's hosted on our domain)
- Pulls the same voice agent the widget points to

Great for: SMS replies ("Tap here to call us"), Linktree-style bios, QR
codes on print, customer-success follow-ups.

## Email signature snippet

Once a slug is set, the editor exposes a copy-paste HTML snippet that
renders a styled call-now pill linking to the hosted page. Drop it into
your email signature editor. Colors and label match the widget config so
edits propagate everywhere.

## Tips

- If allowed-domains is set, the floating button respects it — but the
  hosted page works regardless. So you can lock the widget to your site
  and still share the URL freely.
- Voice agents need a configured Vapi voice; check the agent's **Voice**
  tab if calls fail to connect.
- The button label, color, and icon are all live-previewed in the editor.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // MCP overview
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'mcp-connectors-overview',
    title: 'MCP connectors: what they are and when to use them',
    summary: 'Connect external tools (Meta Ads, Stripe, Linear, anything with an MCP server) and write plain-English rules for when your agent should use them.',
    order: 20,
    body: `**MCP** stands for Model Context Protocol — an open standard for letting
LLMs call external tools. We use it to plug your CRM agent into anything
that exposes an MCP server: Meta Ads, Stripe, Linear, your own internal
APIs, third-party services.

## Why it matters

Built-in tools cover the common CRM flows — booking, tagging, sending
messages, updating opportunities. MCP covers everything else.

A few examples we've seen:

- **Meta Ads** — a contact texts about ad performance. The agent fetches
  ROAS for the last 7 days and replies with the numbers.
- **Stripe** — a customer asks about a charge. The agent looks up the
  invoice, confirms the amount, and replies.
- **Linear** — a contact reports a bug. The agent files a ticket and
  references the ticket number in the reply.
- **Your internal API** — anything you've already built that you want
  the agent to call.

## How it works

Three pieces:

1. **Workspace-level connection** — you connect an MCP server once
   (server URL + auth token). Stored encrypted at rest.
2. **Per-agent attachment** — for each agent, you pick which of the
   server's tools should be available to that agent.
3. **Per-tool rules** — for each enabled tool, you write a plain-English
   "when should the agent use this?" instruction. The agent reads this
   every turn and decides whether the situation matches.

The actual tool execution happens via Anthropic's hosted MCP — we pass
the server config through, Claude calls the tool, the result comes
back inline. We log every call so you can audit.

## What gets logged

Every MCP tool invocation shows up in the agent's **Integrations → Logs**
sub-tab as \`mcp:server-name:tool-name\` alongside the original
conversation. You can see who triggered it, when, and which tool fired.

## Where to start

- [Connect an MCP server](/help/a/mcp-connectors-connect)
- [Write rules for when the agent should use a tool](/help/a/mcp-connectors-rules)

## Curated vs custom

We ship one-click cards for **Meta Ads**, **Stripe**, and **Linear** with
sensible default URLs and auth helper text. Anything else? Use the
**Custom MCP server** option and paste an HTTP MCP URL. Anything that
speaks JSON-RPC over HTTP works.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // MCP setup
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'mcp-connectors-connect',
    title: 'Connect an MCP server',
    summary: 'Step-by-step: pick a curated integration or paste a custom URL, add auth, and discover the available tools.',
    order: 21,
    body: `MCP servers are connected at the workspace level (one connection serves
every agent in the workspace) and attached at the agent level (each agent
picks which tools to enable).

## Connect a server

1. Open any agent → **Integrations** tab
2. Click **+ Connect MCP**
3. Pick a curated card (Meta Ads, Stripe, Linear) **or** click
   **Custom MCP server** to paste a URL
4. The form pre-fills with sensible defaults. Add your auth token:
   - **Bearer token** for most servers (paste the raw token; we add the
     \`Authorization: Bearer …\` header)
   - **Custom header** if the server uses a non-bearer scheme (paste in
     \`Header-Name: value\` format)
   - **No auth** for open/internal MCPs
5. Click **Connect & discover tools**

We immediately call the server's \`tools/list\` endpoint and cache the
result. You'll see the discovered tools listed under the server card.

## Where to find auth tokens

- **Meta Ads** — generate a Marketing API access token with \`ads_read\`
  + \`ads_management\` scopes ([Meta docs](https://developers.facebook.com/docs/marketing-api/get-started))
- **Stripe** — use a restricted API key (\`sk_live_…\` or \`rk_live_…\`).
  Read-only is safest unless you want refunds. ([Stripe dashboard](https://dashboard.stripe.com/apikeys))
- **Linear** — generate a personal API key in
  [Linear → Settings → API](https://linear.app/settings/api)

## Re-discovering tools

If the server adds new tools, click **Re-discover tools** on the server
card to refresh the cached list.

## Per-agent attachment

Discovered tools are not automatically active for any agent. To enable a
tool on an agent:

1. Toggle the tool **on** in the Integrations tab
2. Write a "when to use" rule (see [the rules article](/help/a/mcp-connectors-rules))

Every tool starts disabled by default — you opt each one in deliberately.

## Security model

- Auth tokens are encrypted at rest with AES-256-GCM, keyed by an env
  var (\`SECRETS_ENCRYPTION_KEY\`). They never appear in the dashboard
  after creation, only as a masked indicator.
- The token is only sent at request-time when Anthropic calls the MCP
  server on your behalf.
- Detaching a tool removes the agent's access immediately. Deleting the
  server cascades to remove all attachments across all agents.

## Troubleshooting

- **"MCP server returned 401"** — the token is wrong or expired. Edit
  the server and paste a fresh one.
- **"No tools discovered"** — the server probably doesn't expose
  \`tools/list\`. Most modern MCPs do; some custom servers don't.
- **The agent never calls the tool** — see
  [writing rules](/help/a/mcp-connectors-rules); usually the "when to
  use" text is too generic.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // MCP rules
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'mcp-connectors-rules',
    title: 'Writing rules: when should the agent use a tool?',
    summary: 'Plain-English "when to use" descriptions, optional keyword gates, and the require-approval flag — how to steer the agent without coding.',
    order: 22,
    body: `Connected tools are inert until you write rules for when the agent
should use them. The rule is what turns a generic API into "the agent
fetches Meta Ads ROAS the moment a customer asks about ad performance".

## The "when to use" rule

This is the most important field. Plain English, specific, with concrete
trigger phrases. The agent reads this every turn and decides whether the
situation matches.

**Strong rules** describe the *signal* in the conversation, not the
*action* of the tool:

\`\`\`
When the contact asks about ad performance, ROAS, CPM, CTR, spend, or
conversion numbers for the last 7/30 days.
\`\`\`

**Weak rules** are too vague:

\`\`\`
Use this for ad data.
\`\`\`

Common patterns that work well:

- "When the contact mentions [specific words / topics]"
- "When the contact asks for [specific output]"
- "Only when the contact provides a [specific identifier — order ID,
  customer email, etc.]"
- "Never call this unless the contact has explicitly [confirmed /
  authorized / asked]"

## Required keywords (optional gate)

Comma-separated list. If set, the tool is **completely hidden** from the
agent unless at least one keyword appears in the inbound message
(case-insensitive). This is a hard gate — useful for tools you only ever
want fired in specific contexts.

\`\`\`
ads, campaign, roas, spend, cpm, conversion
\`\`\`

When to use the gate:

- The tool is destructive or expensive ("pause campaign" — only fire
  when the user clearly mentions a campaign)
- The tool would cause confusion if it ever ran by mistake
- The agent has been over-eagerly calling the tool in unrelated contexts

When **not** to use the gate:

- Most read-only tools — the "when to use" rule is enough
- Anything where natural language varies a lot ("look up my account"
  doesn't always include the word "account")

## Require human approval

Toggle this on for tools where you want a human to confirm before the
agent fires. When set:

- The agent is told in its system prompt: "Before calling this tool,
  tell the contact you're checking with the team and stop. Do not
  invoke until the team has confirmed."
- The agent's reply will end with "Let me check with the team" rather
  than firing the tool

This is currently a **soft constraint** — enforcement is via the prompt
to the model, not via execution interception. We're tracking a stricter
hard-stop variant for high-risk tools as a follow-up.

## A worked example

Connecting Meta Ads with three tools:

| Tool | When to use | Keywords | Approval? |
|------|-------------|----------|-----------|
| \`get_campaign_performance\` | Contact asks for ROAS, CTR, CPM, spend, or conversion numbers for any time window. | ads, campaign, roas, spend | No |
| \`pause_campaign\` | Contact reports their ads are spending too fast OR explicitly asks to pause a named campaign. | pause, stop, halt | Yes |
| \`suggest_optimizations\` | Performance is below the contact's stated target and the contact asks what to change. | improve, optimize, fix, why | No |

Result: the agent reads conversation, fetches numbers freely when asked,
suggests changes when prompted, and never pauses anything without a
human in the loop.

## Iterating on rules

Use [Replay & Fork](/help/a/replay-and-fork) to test rule changes against
real past conversations before pushing live. Append a candidate rule in
the Replay editor's "additional instructions" field and see what the
agent would have said.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Replay & Fork
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'replay-and-fork',
    title: 'Replay & Fork: rerun any past conversation through new rules',
    summary: 'Pick a past inbound, optionally override the system prompt or append a candidate rule, and see what the agent would have said. Pure dry run — no sends, no writes.',
    order: 30,
    body: `Tuning agents in production is risky if you're flying blind. **Replay**
lets you re-run any past inbound through any version of your prompt or
rules and see, side-by-side, exactly what the agent would have said.

Open it from any agent → **Replay** tab.

## What it does

For any MessageLog entry, replay:

1. Reconstructs the conversation up to that inbound
2. Re-runs the agent with current settings (or your overrides)
3. Shows the original reply alongside the new reply, plus tools each
   version called

It's a complete dry run:

- No SMS / email / chat sends
- No CRM writes (every write tool no-ops with a sandbox marker)
- No MessageLog row created
- No charges to your monthly usage cap (other than the LLM tokens for
  the replay itself)

## Workflow: tuning a system prompt

1. Open Replay
2. Pick an inbound the agent handled poorly
3. Click **Overrides → Override system prompt**
4. Paste your candidate prompt
5. Click **Replay**
6. Compare the original vs new reply

Iterate until you're happy, then update the agent's actual system prompt
with the winning version.

## Workflow: testing a candidate rule

You wrote a new rule (e.g. "Always offer Tuesday slots first") and want
to know if it would actually fire on real conversations.

1. Open Replay
2. Pick a conversation where the rule should have fired
3. **Overrides → Append additional instructions**
4. Paste the candidate rule
5. Click **Replay** and check if the agent followed it

This is faster than adding the rule to the agent, hoping the next
inbound exercises it, and reverting if not.

## Workflow: spotting regressions

Before pushing a big prompt change, replay 5–10 of your most recent
conversations. If the new prompt produces *worse* replies on the easy
cases, that's a red flag — even if it fixes the hard one you started
with.

## Limits

- Replay uses message history reconstructed from MessageLog rows, not
  the literal raw turn-by-turn record. Outbound replies are included as
  assistant turns; tool calls aren't replayed (we don't re-execute
  every \`get_calendar_events\` from history).
- Tools that need real CRM data still hit your CRM (read-only) so the
  agent can reason. Writes are sandboxed.
- Long conversations only include the last ~8 turns of context — same
  truncation as production.

## Tips

- The contactId is mangled (\`playground-replay-…\`) so write tools
  no-op. You don't need to worry about contaminating real records.
- The "tools used" chip lists each tool the new agent called; useful
  for spotting "the agent skipped get_available_slots" type bugs.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // AI Judge
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'ai-judge',
    title: 'AI Judge: pre-screen flagged messages so humans only see the hard ones',
    summary: 'A small LLM reviews each draft reply that the rules engine flagged for approval. SAFE → auto-release; UNSAFE → optionally auto-block; UNCERTAIN → human review.',
    order: 40,
    body: `The approval queue is a great safety net — but most flagged messages
are perfectly fine, and reviewing every one is exhausting. The **AI
Judge** runs a cheap LLM pass on each flagged draft and decides what to
do with it. Most operators see queue volume drop ~80% the day they
turn it on.

Open it from **Approvals → 🤖 AI Judge settings**.

## How it works

When the existing rules engine flags a draft for approval (low sentiment,
first contact, refund mention, etc.), the judge:

1. Reads the inbound message and the draft reply
2. Reads your custom rubric (optional, see below)
3. Returns one of: **SAFE**, **UNSAFE**, or **UNCERTAIN** with a
   one-line reason
4. The platform decides what to do based on your per-agent settings

## Verdict routing

Per-agent toggles in the AI Judge settings modal:

| Verdict | If \`judgeAutoSend\` ON | If OFF |
|---------|------------------------|--------|
| SAFE | **Released automatically** + sent to contact | Stays in queue for human |
| UNSAFE | (depends on autoBlock) | Stays in queue for human |
| UNCERTAIN | **Always** stays in queue | Always stays in queue |

| Verdict | If \`judgeAutoBlock\` ON | If OFF |
|---------|--------------------------|--------|
| UNSAFE | **Auto-rejected**, never sent | Stays in queue for human |

Recommended starting config:

- **\`judgeAutoSend\`: ON** — SAFE verdicts release without a human.
  This is where the queue-volume reduction comes from.
- **\`judgeAutoBlock\`: OFF** — UNSAFE messages still surface to a
  human until you've watched the judge's verdicts for a few days and
  trust them.

## The rubric

Custom rubric (optional) is where you encode your specific policies.
The judge reads this on every call. Examples:

\`\`\`
- Never auto-send anything that quotes a price
- Auto-send anything that's just confirming a meeting time
- UNSAFE: any reply that promises a refund or guaranteed outcome
- UNSAFE: any reply that mentions specific dollar amounts
- UNCERTAIN: anything mentioning a competitor by name
\`\`\`

The rubric is per-agent. Different agents can have different policies.

## Models

- **Haiku** (default) — fast, ~30× cheaper than Sonnet, great for
  routine messages
- **Sonnet** — slower, more expensive, better at nuanced cases (legal,
  medical, complex business contexts)

Most operators run Haiku across all agents.

## What you see in the queue

Every pending and decided row in the approval queue now shows the
judge's verdict as a chip — green for SAFE, red for UNSAFE, blue for
UNCERTAIN. Hover for the judge's one-line reason.

If you reject a SAFE-judged message, that's a signal the rubric needs
tightening. Add the case to the rubric and the judge will catch it
next time.

## Cost

Each flagged message costs ~1 Haiku call (a few hundred tokens). For a
workspace with 100 daily flagged messages, that's pennies — and you save
the operator hours of review time.

## Failure mode: fail-open

If the judge call fails (API timeout, model error), the message stays
in the queue for human review. The judge **never** auto-rejects on its
own error. You can't get worse outcomes by enabling it — only the same
or better.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Build with AI wizard
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'build-with-ai-wizard',
    title: 'Build with AI: spin up an agent in 3 minutes by describing it',
    summary: 'Skip the templates and the form-filling. Describe what you want the agent to do and we generate the system prompt, rules, qualifying questions, and tool selections for you.',
    order: 50,
    body: `Setting up a new agent has historically meant filling forms across a
dozen tabs — system prompt, behaviour rules, qualifying questions, tool
selections, persona settings. **Build with AI** collapses that into a
3-minute conversation.

Open it from **Agents → + New agent → ✨ Build with AI** (or directly at
\`/agents/new/wizard\`).

## How the conversation works

You start by describing what the agent should do, in plain English:

> "I want an agent that books demos for our SaaS product. It should
> qualify leads on company size and budget before booking."

The wizard asks at most five clarifying questions, one at a time, on
topics like:

- Tone and persona
- Specific behaviors or rules
- What outcome counts as a win
- Anything the agent should never do

When it has enough, it proposes a complete configuration:

- **Name** — short, human-readable
- **System prompt** — the agent's identity and job description
- **Behavior rules** — bullet-list dos and don'ts
- **Tools** — a sensible subset of available tools
- **Detection rules** (optional) — "if X then tag/note/workflow"
- **Qualifying questions** (optional) — questions woven into the
  conversation with capture fields
- **Persona tone** — sets the formality slider

You see the full proposal in a card with collapsible sections. Click
**✓ Create this agent** to mint it, or **Tweak it** to adjust.

## When to use the wizard vs templates

**Wizard is better for:**

- New users who don't know what tools or rules they need
- Specific verticals where templates are too generic ("HVAC technician
  scheduling assistant", "real estate buyer qualifier")
- Quick prototyping — get something live and iterate

**Templates are better for:**

- Standard sales / support / scheduling flows where the template fits
  cleanly
- When you want a known starting point to customize manually
- Replicating an existing agent's setup

After creation, you land on the agent's settings tab and can edit
anything — channels, persona details, additional rules, tools. The
wizard creates a real agent, not a placeholder.

## Pro tips

- **Be specific about the win.** "Book a demo with sales" is better
  than "qualify leads". The wizard uses this to pick tools and shape
  the prompt.
- **Mention your industry.** "We sell HVAC services to homeowners" gives
  the wizard much better defaults than "we sell things".
- **Mention what NOT to do.** "Never quote prices, never promise refunds,
  never mention competitors" become explicit behavior rules.
- **Skip what you don't care about.** If the wizard asks about persona
  tone and you don't have a preference, say so — defaults are fine.

## After creation

The new agent is live but not deployed. You'll still need to:

1. Connect it to a channel under the **Channels** tab
2. Activate it (top-right toggle on the agent page)
3. Optionally fine-tune anything the wizard generated

The whole flow — describe → review → create → channel → activate —
is usually under 10 minutes for a fresh agent.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Inbox: assignment + routing
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'inbox-assignment-routing',
    title: 'Assign chats to teammates and auto-route widget conversations',
    summary: 'Operators own conversations like in Intercom — manual claim, round-robin, or lightest-load auto-routing, with availability presence.',
    order: 60,
    body: `Widget chats no longer just sit in a shared queue. Each conversation
can have a single **assigned operator** — set automatically when the AI
hands off, when a teammate replies, or manually from the inbox.

## What's new

- **Assignee on every chat.** Visible on every inbox row and in the
  conversation header.
- **Inbox filters: Assigned to me / Unassigned / Everyone.** Operators
  see only their work without scrolling past everyone else's.
- **Available / Away presence.** Toggle from the inbox header. Auto-
  routing skips "away" teammates so chats land with someone who's
  actually online.
- **Per-widget routing modes.** Configure how a specific widget assigns
  chats: Manual (sit in queue), Round-robin (cycle through teammates),
  or Lightest-load (whoever has the fewest open chats).
- **Personal "assigned to you" notification.** New event in the
  notifications panel — fires only on the assignee, not the whole team.

## Three routing modes

Pick one per widget under **Widgets → \\[your widget\\] → Routing →
Operator routing**. They only kick in when a chat needs a human (AI
handover or manual takeover) — the AI handles things normally before
that.

**Manual** — chats stay in the unassigned queue until someone claims
them from the inbox. Best when one person is on duty at a time, or
when you want full discretion.

**Round-robin** — cycles through eligible *available* teammates in
deterministic order, using a stored cursor so the next chat goes to
the next person. Perfect for fair distribution across a team.

**Lightest load** — picks the available teammate with the fewest open
chats (status: active or handed_off). Smooths things out when one
operator gets buried.

For round-robin and lightest-load, you can pin the **eligible
teammates** — leave all unchecked to include everyone in the workspace,
or check specific people for a sub-team.

## Manual assignment

Click the assignee chip in the conversation header to:

- **Claim this chat** (one-click for "I'm taking this")
- **Pick a teammate** from the dropdown — anyone in the workspace,
  even teammates marked away (manual override)
- **Unassign** to drop it back into the queue

Assignment changes broadcast in real-time, so every open inbox tab
updates the moment someone claims or hands off.

## Self-claim by replying

If you reply to an unassigned chat from the operator inbox, you
automatically become the assignee. Mirrors the Intercom convention —
whoever picks up the thread becomes the de-facto owner unless someone
reassigns.

## Available / Away

The toggle in the inbox header (top-right) sets your availability.
**Available** means round-robin and lightest-load can route chats to
you. **Away** keeps you in the workspace but auto-routing skips you.

Toggle to Away when you're stepping out for lunch, in a meeting, or
just don't want to be auto-assigned. Manual assignments still work
either way — a teammate can still pick you specifically.

## Notifications

The new **\`widget.conversation_assigned\`** event fires when you get
assigned. By default it sends:

- A web push to your browser
- An email with a deep link to the chat

Manage it under **Settings → Notifications**. The event is *personal* —
it only goes to the assignee, not the whole workspace, so you don't
spam Slack on every assignment.

## Common patterns

**Solo operator** — set routing to Manual, leave yourself Available.
You see every new chat in the Unassigned queue and pick what to claim.

**Small team, even split** — Round-robin across all eligible teammates.
Toggle yourself Away when you step out and the rotation skips you.

**Tiered support** — Lightest-load mode, and pin only your tier-1
operators as eligible. Tier-2/3 teammates only get chats by manual
hand-off from tier-1.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Brands — whitelabel client identity
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'brands-whitelabel',
    title: 'Brands — run a whitelabel agency from one workspace',
    summary: 'Tag widgets and knowledge collections to a brand. Inbox filters, transcript exports, and per-client knowledge stay clean — even when one team handles many brands.',
    order: 80,
    body: `If you represent multiple clients (whitelabel agency, holdco
support team, MSP), you need one operator queue, one set of agents,
but cleanly separated **conversations, knowledge, and reporting** per
brand. Brands let you tag widgets and collections so the right things
filter, group, and export under each client identity — without
spinning up a workspace per brand.

## What a brand is

A brand is a small workspace-level entity:

- **Name** — the human label ("Acme Corp", "Beta Co").
- **Slug** — URL-safe identifier used in transcript exports and the
  brand-scoped inbox URL.
- **Logo + accent color** — for visual identification on the operator
  inbox so a glance tells you which brand a chat is for.
- **Description** — optional notes for your team.

It's optional. Workspaces that aren't running a multi-brand setup
ignore the whole concept; the inbox doesn't show brand controls when
there are no brands.

## Tag widgets to a brand

Each widget has a **Brand** dropdown in its Routing section. Picking
a brand flows through to:

- **Inbox row chip** — every conversation from that widget shows the
  brand chip with logo and accent color.
- **Inbox brand filter** — operators can scope to one brand at a time.
- **Transcript export** — the per-brand JSON / text export pulls
  every conversation on every widget tagged to that brand.

Untagged widgets keep working — they just show up in "Untagged" in
the inbox brand filter.

## Tag collections to a brand

When you create a Knowledge Collection, you can pick a brand:

- **Brand-scoped** — only relevant to that client. "Acme refund
  policy," "Beta shipping windows."
- **Shared across brands** (no brand picked) — useful for things that
  are universal in your team's voice or method, regardless of which
  brand you're representing.

Connect collections to agents the same way as before — agents pick
which collections to use. A single agent can handle multiple brands
by being attached to brand-scoped collections for each one.

## The inbox

Open **Inbox** in the left nav. With brands defined, a new **Brand**
filter row appears (above the status tabs):

- **All** (default) — every conversation, brand or not.
- **Untagged** — conversations on widgets that aren't tagged to any
  brand.
- **One row per brand** — click to scope.

When you scope to a specific brand, an **Export** button appears in
the top-right of the brand filter row. Click it to download every
conversation tagged to that brand as JSON.

## Transcript exports

Two formats, both via the brand detail or inbox:

\`GET /api/workspaces/:wid/brands/:bid/transcripts/export?format=json\`
- Full structured export — every conversation, every message, CSAT
  ratings, assignment, timestamps. Filename: \`<brand-slug>-transcripts-<date>.json\`.

\`?format=text\`
- Human-readable plain-text concatenation. Useful for skimming or
  feeding into a QA review.

Optional query params:
- \`from=YYYY-MM-DD\` and \`to=YYYY-MM-DD\` — date range.
- \`status=ended\` (or \`active\` / \`handed_off\`) — narrow to one status.

Capped at 1,000 conversations per export — chunk longer archives via
the date range.

## A clean pattern

For an agency running 5 brands:

1. Create 5 brands under **Brands** in the left nav.
2. For each brand, create one widget tagged to it (chat or
   click-to-call). Different colours, logos, hostnames in
   "Allowed domains."
3. Create one **Brand-scoped collection** per brand for FAQs, refund
   terms, and any client-specific docs.
4. Create one **shared collection** per skill (Brand voice, support
   playbook) — no brand tag, used by every agent.
5. One agent per brand: attach the brand's collections + the shared
   ones. The agent runs with the right knowledge mix automatically.
6. Operators sit in **Inbox** and either work the All view or scope
   to a brand. The brand chip on each conversation makes context
   obvious without clicking in.

When clients ask for a transcript audit ("show me everything that
went through Acme last quarter"), open Brands, click the brand,
and hit Export.

## Things to know

- **Deleting a brand doesn't delete widgets or collections.** They
  become "untagged" and stay in the workspace.
- **Brands are workspace-scoped.** If you need cross-workspace brand
  separation, you still need separate workspaces.
- **The brand chip is purely visual** — the brand identity doesn't
  alter the agent's behaviour. To change voice or knowledge per
  brand, swap which collections each agent uses.
`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Knowledge Collections — the canonical write-up for the shipped
  // Collections model. Replaces two intermediate articles
  // ('workspace-knowledge-library' and the earlier knowledge-collections
  // placeholder), which the seed handler prunes from the DB on next run.
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'knowledge-collections',
    title: 'Knowledge Collections',
    summary: 'Build named bundles of FAQs, files, web pages, Notion docs, YouTube transcripts, and live data sources. Agents pick which collections to use — multi-select, stacked, edit once.',
    order: 70,
    body: `Knowledge lives in **Collections** — named, reusable bundles of
everything an agent needs to know about a topic. A collection holds
written notes, FAQs, uploaded files, crawled web pages, Notion docs,
YouTube transcripts, *and* live data sources (Google Sheets, Airtable,
REST endpoints), all in one place. Agents don't own knowledge directly
anymore — they connect to one or more collections, and inherit
everything inside.

## The shape of it

- **Collections live at the workspace level.** Open the **Knowledge**
  tab in the left nav. Every collection in the workspace shows as a
  card with its icon, item count, data-source count, and how many
  agents it's connected to.
- **Items inside a collection** are mixed-type. A single collection
  can hold a written FAQ, a PDF you uploaded, three crawled pages from
  your help docs, and a Google Sheets data source — side by side. The
  agent gets the static items as context in its prompt, and the data
  sources as live-lookup tools.
- **Agents subscribe.** Each agent's **Knowledge** sub-page is a
  checklist of every collection in the workspace. Tick the ones the
  agent should use. Save. Done.

## Building a collection

1. Go to **Knowledge** in the left nav and click **+ New collection**.
2. Give it a name, an icon, and an accent colour. (e.g. "Refunds &
   returns" 🛒, "Product specs" 📦, "Brand voice" 💼.)
3. Open the collection. You'll see three tabs:

### Items tab
The "things the agent should read" — static knowledge pulled into the
system prompt. Six ways to add an item:

- **Write** — a manual entry. Title + body.
- **Q&A** — paste in question/answer pairs; each becomes its own item
  so the agent can match individually.
- **Crawl URL** — paste a web URL; we fetch the page, strip
  formatting, chunk long content, and store the text. Comes back fast
  with a chunk count.
- **Upload file** — PDF, TXT, or Markdown (max 5 MB). Long files chunk
  automatically.
- **Notion / YouTube** — coming back into the collection editor; for
  now use **Write** to paste the text.

### Data sources tab
The "things the agent can look up live" — credentials and config for
Google Sheets, Airtable, or REST GET endpoints. Each data source
becomes a tool the agent can call mid-conversation:

- **Google Sheet** — pulls rows by query.
- **Airtable** — queries records with formula filters.
- **REST GET** — hits any HTTP endpoint and returns the JSON.

Give it a slug name (lowercase, e.g. \`inventory\`); the agent calls
it by that name. Paste the credentials — they're stored encrypted.

### Connected agents tab
Multi-select checklist of every agent in the workspace. Tick the ones
that should use this collection. Save replaces the full set — anything
you uncheck gets disconnected.

## Connecting from the agent side

You can also wire collections from an agent's perspective. On any
agent, the **Knowledge** sub-page is now a picker — every workspace
collection appears with a checkbox. Tick the ones you want, hit Save.
Same effect, different angle. Use whichever feels natural for the
moment.

## Why this exists

Before Collections, knowledge and data sources lived in two unrelated
places — and knowledge entries were locked to a single agent. Sharing
the same FAQ across three agents meant duplicating it three times,
then editing three copies whenever something changed.

Collections fix all three:

- **One bundle, many agents.** A "Brand voice" collection on every
  customer-facing agent. Update once; every agent picks it up next
  turn.
- **Mixed types in one place.** The "Product specs" collection holds
  the spec PDF, the FAQ pairs, and the live inventory Sheet. An agent
  attached to it gets all three on the same connection.
- **Build once, reuse anywhere.** When you spin up a new agent, you
  don't rebuild knowledge — you tick the collections it needs and
  start tuning behaviour instead.

## Migration

Everything from before — knowledge entries you'd written and data
sources you'd configured — was automatically dropped into a default
**General** collection in each workspace. Every agent that previously
used those items was connected to General. Day-one prompt context is
identical to what it was before.

To reorganise, just create new collections and move items by
recreating them in the right place (each item belongs to exactly one
collection). Or rename **General** and split items into topic-specific
collections as you go.

## A clean pattern

For workspaces with multiple agents on the same business, a
collection-per-topic layout works well:

- **Brand voice** (one shared collection) → on every agent.
- **Refunds & returns** → on support + voice agents.
- **Product specs** (with the inventory Sheet inside) → on sales +
  support + voice agents.
- **Sales playbook** → on sales agent only.

Each agent inherits exactly what it needs by checking 2–4 collections,
and any change you make to a collection ripples to every agent on it.

## Things to know

- **Delete a collection** to remove it everywhere. Every connected
  agent loses access; the items inside are deleted too.
- **Delete an item inside a collection** to remove just that item.
  Other items in the collection stay; agents keep using the
  collection.
- **Disconnect an agent** by un-ticking the collection in the agent's
  Knowledge picker (or in the collection's Connected agents tab). The
  collection survives untouched.
- **Data sources only surface as tools** when an agent connects to the
  collection that holds them. So you control which agents can call
  which data sources by where you put them.
`,
  },
]
