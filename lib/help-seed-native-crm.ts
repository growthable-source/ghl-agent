/**
 * Help center seed data for the "Native CRM" category.
 *
 * Shipped as drafts — every article carries `status: 'draft'` so they
 * stay hidden from the public help index until the dashboard UI is
 * ready to back them up. Flip an article to `'published'` here and
 * rerun /api/help/seed-native-crm when each surface goes live.
 *
 * Idempotent: keyed by article slug, so editing a body and rerunning
 * the seeder updates the article in place.
 */
export const NATIVE_CRM_CATEGORY = {
  slug: 'native-crm',
  name: 'Native CRM',
  description: 'Built-in contacts, lists, and outbound for workspaces that don\'t connect an external CRM.',
  icon: '📇',
  order: 4,
}

export const NATIVE_CRM_ARTICLES = [
  // ───────────────────────────────────────────────────────────────────
  // Overview
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-overview',
    status: 'draft',
    title: 'Native CRM vs. connect GoHighLevel: which to pick',
    summary: 'When the built-in CRM is enough, when you should connect GHL or HubSpot, and how to switch later if your needs change.',
    order: 10,
    body: `Every workspace runs on one of two CRM backends: **Native** (built-in)
or an external integration (**GoHighLevel** or **HubSpot**). You pick
during onboarding and can switch later — your agents and conversations
stay put.

## Native CRM — when it's the right fit

Pick Native when you want to:

- Load a lead list and start outbound the same day
- Track contacts, tags, and custom fields without paying for a separate CRM
- Manage opt-outs, dedupe imports, and segment by tag
- Run a pure outbound or inbound chat operation without pipelines/deals

You get:

- Contacts database with email + phone dedupe
- CSV import with column mapping and per-row error tracking
- Static lists and smart (filter-based) segments
- Workspace-wide suppression list (STOP / unsubscribe handling)
- Custom fields available in agent merge tags
- Conversations and message history backed by us

## Connect GoHighLevel or HubSpot — when you should

Pick an external CRM when you need:

- **Pipelines and deals** — moving opportunities through stages, win/loss tracking
- **Calendar booking** — checking availability, scheduling appointments
- **GHL workflows** — triggering automations, adding contacts to existing flows
- **Pre-existing data** — your contacts already live in GHL or HubSpot

The agent on a native workspace will tell you "this isn't available on
the native plan — connect GoHighLevel" if it's asked to move a deal or
book a meeting. That's by design — the upgrade path stays explicit.

## Switching later

Switching is non-destructive: your agents, conversations, and message
history stay where they are. What changes is the data the agent reads on
each turn (contact details, custom fields, deal context).

- **Native → GHL/HubSpot:** connect from **Integrations**, then flip the
  workspace's CRM provider to the external one. Native contacts stay in
  the DB but the agent stops using them; export them via API if you want
  to push them into the new CRM.
- **GHL/HubSpot → Native:** disconnect the integration, provision native
  via **Integrations → Switch to Native**. Your existing conversation
  history is untouched; new contacts go into the native store.

There's no time pressure — most teams start on Native, get a feel for
the agent, then graduate to GHL when they need pipelines.`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Provisioning / switching
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-provision',
    status: 'draft',
    title: 'Switching your workspace to the native CRM',
    summary: 'The two-click flow to provision native contacts on a workspace, plus what happens to existing agents and history.',
    order: 20,
    body: `Switching to native takes two clicks and is non-destructive — your
agents, prompts, conversations, and message history all stay put.

## How to switch

1. Go to **Integrations**
2. Under **CRM**, click **Switch to Native**
3. Confirm

Behind the scenes we provision a Location row keyed
\`native:<your-workspace-id>\` and flip your workspace's CRM provider to
\`native\`. Your agents start reading from the built-in contacts store
on their next turn — no redeploy, no downtime.

## What changes

- The agent's contact-lookup tools (\`get_contact_details\`, \`find_contact_by_email_or_phone\`)
  read from native contacts instead of GoHighLevel.
- \`send_sms\` / \`send_email\` persist messages to native conversations.
  Outbound delivery routes through your configured channel (see
  [Outbound channels](/help/a/native-crm-outbound-channels) once your
  workspace is set up).
- Pipeline and calendar tools throw "not available — connect a CRM"
  if the agent tries to use them.

## What doesn't change

- Existing agents and prompts
- Conversation history (anything that's already happened stays attached
  to the original CRM, including any GHL contacts that are mid-thread)
- Widgets, brands, knowledge collections
- Billing — native is included in your existing plan

## Rolling back

You can switch back at any time from the same screen. We don't delete
native data when you switch away — it stays available in the DB and is
re-attached if you switch back.`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Importing contacts
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-import-contacts',
    status: 'draft',
    title: 'Importing contacts from a CSV',
    summary: 'How the importer maps columns, dedupes against existing contacts, applies the suppression list, and tracks per-row errors so you can fix and re-upload just the rejected rows.',
    order: 30,
    body: `The CSV import flow is built around the assumption that real lead lists
are messy — duplicate rows, half-filled cells, the occasional "DO NOT
CONTACT" string in the email column. Rather than failing the whole
import on the first bad row, the importer processes everything it can
and tells you exactly which rows didn't make it.

## How to import

1. Go to **Contacts → Import**
2. Drop your CSV (or click to browse)
3. Map your CSV columns to contact fields — first name, last name, email,
   phone, tags, custom fields. Anything you don't want imported, mark as
   **Skip**.
4. Optionally pick a list to add every imported contact to
5. Click **Start import**

The importer runs synchronously for files up to a few thousand rows; for
larger lists it queues and you'll get a notification when it's done.

## What the importer does

For every row, in order:

1. **Apply your column mapping** — pull out the standard fields and any
   custom-field values
2. **Normalise email and phone** — emails are lowercased; phones are
   converted to E.164 (e.g. \`+15551234567\`) where possible
3. **Reject rows with no email or phone** — every contact needs at least
   one reachable identifier
4. **Dedupe within the file** — if the same email or phone appears twice
   in your CSV, only the first row wins
5. **Dedupe against your workspace** — rows matching an existing
   contact's email or phone are skipped (counted as "duplicates")
6. **Check the suppression list** — rows whose email or phone is on the
   suppression list are skipped (counted as "suppressed")
7. **Insert** the contact and add it to your selected list

Every rejected row goes into a per-import error log with the row number,
the original cell values, and the reason. Once the import finishes you
can download "errors only" as a CSV, fix the issues, and re-upload —
existing imports won't double up because dedupe is per-workspace.

## CSV format tips

- **Headers required.** The first row is treated as column headers and
  used in the mapping step. We don't auto-detect.
- **Tags column** — comma- or semicolon-separated tags in a single cell
  (\`vip;newsletter\` or \`vip, newsletter\`) split into individual tags.
- **Phone formats** — \`(555) 123-4567\`, \`555-123-4567\`, \`+1 555 123 4567\`
  all normalise to \`+15551234567\`. International numbers without a
  country code stay as-is — add the \`+\` and country code if you want
  reliable dedupe.
- **Custom field columns** — map them in the mapping step; their values
  go into the contact's customFields blob and become available as
  \`{{contact.<field_key>}}\` merge tags in your agent.

## Re-importing the same file

Safe. Every row will hit the dedupe step and be skipped. The only thing
that changes is list membership — if you re-imported with a different
target list, the matching contacts get added to the new list too
(existing list memberships stay).`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Lists and segments
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-lists',
    status: 'draft',
    title: 'Lists and smart segments',
    summary: 'Static lists for hand-curated cohorts, smart lists for "everyone with tag X" — when to use which, and how the agent uses list membership for outbound.',
    order: 40,
    body: `Lists are how you group contacts for outbound campaigns, segmented
follow-ups, or just internal organisation. There are two kinds.

## Static lists

You add and remove contacts manually. Membership is exactly what you
put in — nothing changes unless you change it.

Use static lists when:

- You're running a one-off campaign against a fixed cohort
- You're importing a CSV and want everyone from that file in one bucket
- The list represents a real-world status that's tracked elsewhere
  (e.g. "trade show booth signups May 2026")

## Smart lists

You define a filter; membership resolves at read time. Add a contact who
matches the filter and they appear in the list automatically. Remove
the matching tag and they drop out.

Smart-list filters supported today:

- **Has all of these tags** — contact must have every tag in the set
- **Has any of these tags** — contact must have at least one tag in the set
- **Name contains** — substring match against first or last name
- **Include suppressed** — by default smart lists exclude opted-out
  contacts; flip this if you genuinely want to see everyone

Use smart lists when:

- The cohort is rule-based (\`tag = "vip"\`, \`tag = "trial-day-3"\`)
- Membership should track status changes automatically
- You don't want to maintain manual list hygiene

## How the agent uses lists

For outbound campaigns: pick a list, kick off the run, and the agent
processes every member in turn. Suppressed contacts are skipped
automatically — the suppression list always wins over list membership.

For inbound: lists don't gate behaviour, but the agent can read a
contact's list memberships in its decision-making (e.g. "this contact
is in the High-Intent list, lean towards immediate handoff").

## Limits

- 1,000 lists per workspace (lift via support if you genuinely need more)
- Static-list membership scales to 1M+ contacts; smart-list filters
  resolve in <1s for workspaces under ~500k contacts. Past that, prefer
  static lists.`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Suppression
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-suppression',
    status: 'draft',
    title: 'The suppression list (opt-outs and STOP replies)',
    summary: 'How STOP replies, bounces, and manual blocks all converge into one workspace-wide opt-out store, and how the agent honours it.',
    order: 50,
    body: `The suppression list is the single source of truth for "do not
contact." It's workspace-wide, channel-aware, and consulted at both
import time and send time so opted-out addresses never receive an
outbound message — even if they're sitting in a list.

## What goes on the list

- **STOP replies** — when a contact replies STOP / UNSUBSCRIBE to an
  SMS, their phone is added automatically with reason \`stop_reply\`
- **Email unsubscribe clicks** — added with reason \`unsubscribe\`
- **Hard bounces** — emails that bounce permanently are added with
  reason \`bounce\`
- **Manual blocks** — anything you add yourself via the Suppression
  page or the API, with reason \`manual\` (or your own free-form note)

Each entry stores the reason and the timestamp so you have an audit
trail when a contact asks "why am I not getting your messages?"

## How sends honour it

At every outbound send, before the message goes to the delivery rail:

1. Look up the contact's email and phone in the suppression list
2. If either is suppressed, the message is **not sent** and the agent
   sees a "contact unreachable" signal so it can adapt mid-conversation
3. The contact's \`isSuppressed\` flag is also set, so list views show
   the badge without joining the suppression table on every render

Imports run the same check — suppressed addresses in your CSV are
counted as "skipped" rather than created.

## Adding manually

From the **Suppression** page:

1. Click **Add suppression**
2. Pick **Email** or **Phone**
3. Paste the value
4. Optionally write a note ("complained on Twitter", "sales rep request")

Adding the same value twice is a no-op — the existing reason is
updated, no duplicate row is created.

## Removing

You can remove an entry — the contact becomes reachable again on its
next turn. Use this for genuine accidents (someone shared an address
with their team and one person opted out for the wrong reason).
**Removing a STOP-reply entry on someone's behalf without their
explicit consent is illegal in most jurisdictions** — check your
compliance obligations first.

## Bulk import

You can bulk-load a suppression list from a CSV (one column, header
\`email\` or \`phone\`). Useful when migrating from another platform —
import their unsubscribe list before you start outbound so you don't
re-message anyone who already opted out.`,
  },

  // ───────────────────────────────────────────────────────────────────
  // Custom fields
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-custom-fields',
    status: 'draft',
    title: 'Custom fields',
    summary: 'Define workspace-scoped fields, type them correctly, and reference them in agent merge tags.',
    order: 60,
    body: `Custom fields are how you store anything that isn't first name, last
name, email, phone, or tags. They live on the contact, are workspace-scoped,
and are available to your agent as \`{{contact.<field_key>}}\` merge tags.

## Defining a field

From the **Contacts → Custom fields** page:

1. Click **Add field**
2. Pick a label (\`Vehicle VIN\`) and a field key (\`vehicle_vin\`)
3. Pick a data type:
   - **Text** — free-form string
   - **Number** — integer or decimal
   - **Date** — ISO 8601 (\`2026-05-04\`)
   - **Select** — single choice from a list of options
   - **Multi-select** — multiple choices
   - **Boolean** — true / false
   - **Phone** — auto-normalised to E.164
   - **Email** — auto-lowercased
   - **URL** — validated as an http(s) URL
4. Save

Field keys must be unique within the workspace and use snake_case so
they're safe in merge tags.

## Using in your agent

Reference any defined field by its key:

\`\`\`
Hi {{contact.first_name|there}}, just confirming the VIN we have on file
is {{contact.vehicle_vin|"not yet provided"}}.
\`\`\`

The pipe-default syntax kicks in when the field is empty, so the
agent never says "Hi , just confirming the VIN we have on file is ."

## Setting values

- **From CSV import** — map a CSV column to the custom field during
  import (the mapping picker shows your custom fields under "Custom").
- **From the agent** — when the \`update_contact_field\` tool is enabled,
  the agent can write custom fields directly mid-conversation.
- **Manually** — from the contact detail page, click any custom field
  to edit.

## Limits

- 50 custom fields per workspace (lift via support)
- Max value length: 4KB (Text), 64KB (Multi-select option list combined)
- Fields can't be renamed once they have data — create a new field and
  migrate values via the API if you need to.`,
  },

  // ───────────────────────────────────────────────────────────────────
  // What's not on native
  // ───────────────────────────────────────────────────────────────────
  {
    slug: 'native-crm-limits',
    status: 'draft',
    title: 'What\'s not available on the native plan',
    summary: 'Pipelines, deals, and calendar booking are GHL/HubSpot-only — what each one is, why it\'s not on native, and how to upgrade if you need them.',
    order: 70,
    body: `Native covers contacts, lists, conversations, and outbound. Three
things it deliberately doesn't:

## Pipelines and deals

If your sales process tracks opportunities through stages
(\`prospect → demo → negotiation → won/lost\`), with values, owners,
and forecasts — that's a pipeline. Pipelines and the \`Opportunity\`
tools (\`get_opportunities\`, \`move_opportunity_stage\`,
\`create_opportunity\`, \`mark_opportunity_won/lost\`) are only available
when you connect GoHighLevel or HubSpot.

If your agent tries to call those tools on a native workspace it
returns "not available — connect a CRM" rather than silently
no-op'ing, so the agent surfaces the upgrade path to the user
instead of pretending to succeed.

## Calendar booking

Free-slot lookups and appointment creation
(\`get_available_slots\`, \`book_appointment\`,
\`reschedule_appointment\`, \`cancel_appointment\`) are GHL/HubSpot-only.
The native plan doesn't ship a built-in calendar.

If your use case is "book a meeting with our sales rep," you need
GoHighLevel's calendar (or Google Calendar via HubSpot's meetings).

## GHL workflows

\`add_to_workflow\` / \`remove_from_workflow\` are GHL-specific —
they trigger automations defined in your GHL account. There's no
native equivalent because the workflows themselves live in GHL.

## How to upgrade

1. Go to **Integrations**
2. Connect GoHighLevel or HubSpot
3. Switch your workspace's CRM provider to the new integration

Your native contacts and conversations stay in the DB and become
read-only. The agent starts reading from GHL/HubSpot for everything
on the next turn — no redeploy, no data loss.

If you want a one-time export of your native contacts to push into
GoHighLevel, hit the API or reach out to support.`,
  },
]
