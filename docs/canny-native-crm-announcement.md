# Canny changelog post — Native CRM

Copy-paste content for the public Canny changelog announcing the native
CRM rollout. Title goes in the post title field; everything below the
divider goes in the post body (Canny supports markdown).

---

## Title

Native CRM: skip the GoHighLevel setup, start with built-in contacts

## Body

Until now, building an agent meant connecting GoHighLevel before you could
do anything beyond a website widget. For teams who just wanted to load a
lead list and let an agent reach out, that was a real friction point.

**Native CRM** is the built-in alternative. Your workspace gets its own
contacts, lists, conversations, and outbound messaging — all backed by us.
No external CRM required. Connect GoHighLevel later if you outgrow it;
nothing moves until you decide.

### What you'll get

- **Contacts database** with email + phone dedupe and custom fields
- **CSV import** with column mapping, suppression handling, and per-row
  error tracking — fix the rejected rows and re-upload, no double-ups
- **Lists and segments** — static lists for hand-curated cohorts, smart
  lists that resolve from a tag or name filter at read time
- **Suppression list** — one workspace-wide opt-out store. STOP replies
  and bounces register automatically; manual blocks supported too
- **Custom fields** usable as `{{contact.<field_key>}}` merge tags in
  any agent prompt

### What's not on native

Pipelines, deals, and calendar booking. Those stay GoHighLevel /
HubSpot territory — connect either if you need them. Switching later
is non-destructive: agents, prompts, and conversation history all stay
put.

### Where we are right now

The **backend foundation is live** as of this release: schema, the
adapter the agent runs on, the import pipeline, suppression, and the
provisioning endpoint. If you're API-savvy you can already drive
everything via direct calls — reach out for early access docs.

The **dashboard UI** for managing contacts, lists, and imports is
**rolling out in the next sprint**. Outbound delivery (turning a queued
message into an actual SMS or email via Twilio / SMTP) is the sprint
after that.

We'll bump this post when each piece lands. Subscribe to the changelog
to get notified.

### Why we built this

Roughly 1 in 4 trial signups bounced before connecting their CRM —
specifically because GoHighLevel setup is its own onboarding before
ours even starts. Native CRM removes that wall: spin up a workspace,
import your leads, and your agent has somewhere to read and write the
same day.

---

## Suggested tags

`feature` `crm` `imports` `outbound`
