# Marketplace listing copy

Paste these into the corresponding fields in the LeadConnector marketplace
builder. Each section is sized to common field limits (short description
~500 chars, full description ~3000 chars).

---

## App name

Xovera

## Tagline (≤ 150 chars)

> AI agents that live inside your CRM — answering SMS, DMs, voice calls, and web chat while updating contacts, pipelines, and calendars.

## Short description (≤ 500 chars, marketplace card)

> Xovera installs AI agents directly into your sub-account. They reply to inbound messages across SMS, Messenger, Instagram, email, voice, and web chat — and update contacts, move opportunities, book appointments, and trigger workflows the same way your team would. Set up in under five minutes. No data migration, no second inbox to check.

## Full description

> ### AI agents that actually use your CRM
>
> Xovera is an AI agent platform built for LeadConnector. Every agent you create reads and writes your existing data — contacts, conversations, pipelines, calendars, tags, custom fields, workflows — through the tools your team already uses. Nothing to migrate. No parallel inbox.
>
> ### One install, every channel
>
> Agents handle inbound across:
>
> - **SMS** through your existing phone numbers
> - **Email** with full thread context
> - **Facebook Messenger and Instagram DMs**
> - **Web chat** via a one-line embed for your site
> - **Voice calls** with real-time AI calling and transcripts written back to your CRM
>
> You pick which channels each agent listens on. Different agents specialize — one for inbound leads, one for support, one for outbound follow-ups — and routing rules direct conversations to the right one automatically.
>
> ### They take action, not just chat
>
> Xovera agents:
>
> - Pull up the contact's history before they reply
> - Tag contacts based on what's said in the conversation
> - Move opportunities through your pipelines when stages change
> - Book appointments on your team's calendars
> - Add notes to opportunities
> - Enroll or remove contacts from workflows
> - Update custom fields from the conversation
>
> Every action shows up natively in your CRM. Your team sees the same data they always have — just with the AI doing the work.
>
> ### Setup in under five minutes
>
> Install from the marketplace. We provision a Xovera workspace tied to your sub-account automatically, then walk you through:
>
> 1. Pick an agent template (sales, support, assistant, live chat)
> 2. Choose channels — we pre-select the ones already wired up in your sub-account
> 3. Customise tone, languages, working hours, fallback behaviour, knowledge sources
> 4. Ship
>
> Most agents are live in your inbox within five minutes of install.
>
> ### Plus
>
> - **Voice AI calling** with custom voices and full call transcripts
> - **Knowledge collections** — point agents at your help docs, PDFs, websites
> - **Simulation testing** — rehearse agents against scripted scenarios before shipping
> - **AI Judge** — quality-control layer that reviews every reply before send
> - **Routing rules** in plain English: "If they mention pricing, send to the sales agent"
> - **Follow-up sequences** triggered by conversation outcomes
> - **Per-agent custom instructions, working hours, languages, and tone**
>
> ### Pricing
>
> Free 7-day trial, then plans from US$X/month. Full pricing at xovera.io/pricing.
>
> ### Support
>
> Docs: docs.xovera.io
> Email: support@xovera.io

## Key features (for the marketplace's bullet list)

- AI agents reply to SMS, Messenger, Instagram, email, web chat, and voice
- Reads + writes your contacts, opportunities, calendars, tags, custom fields, and workflows
- Books appointments on your calendars; moves opportunities through your pipelines
- One install per sub-account — opens as a menu item inside your CRM
- Multi-agent workspaces with per-agent channels, tone, languages, and knowledge
- Free 7-day trial, no credit card required

## Categories

- Communication
- Sales
- AI / Automation
- Lead management

## Required permissions (rendered automatically from your scope set, but worth listing in the description for transparency)

Xovera requests these scopes when you install:

- `contacts.readonly`, `contacts.write` — read and update contacts the agent talks to
- `conversations.readonly`, `conversations.write`, `conversations/message.readonly`, `conversations/message.write` — read your inbox, send replies
- `opportunities.readonly`, `opportunities.write` — move deals as conversations progress
- `calendars.readonly`, `calendars.write`, `calendars/events.readonly`, `calendars/events.write` — book appointments
- `locations.readonly` — name the workspace from your sub-account at install time
- `locations/customFields.readonly`, `locations/customFields.write` — read and update custom fields
- `locations/tags.readonly`, `locations/tags.write` — apply tags from the conversation
- `users.readonly` — render `{{user.*}}` merge fields
- `workflows.readonly` — let the agent enrol contacts in your workflows

## Setup screenshot captions (if the listing supports them)

1. **Install** — One click from the marketplace. Xovera provisions a workspace tied to your sub-account.
2. **Pick a template** — Outbound sales, inbound assistant, support, or live chat. Each comes pre-tuned with prompts and tools.
3. **Choose channels** — We pre-select the channels already connected in your sub-account.
4. **Ship** — The agent appears in your inbox and starts handling inbound the same way your team would.

## Cancellation / uninstall blurb

You can disconnect Xovera from your sub-account at any time from Settings → Integrations. Your contacts, conversations, and pipeline data stay where they are — we never delete anything from your CRM. Xovera just stops listening.

---

## Things to fill in before submission

- **Pricing**: replace `US$X/month` with the actual entry-level price.
- **Support email**: confirm `support@xovera.io` is monitored (or use a different inbox).
- **Docs URL**: `docs.xovera.io` is hypothetical — replace with the actual docs domain when it's live, or drop the line if there are no public docs yet.
- **Screenshots**: the listing builder will want 3-5 product screenshots. Suggested set:
  1. Agent picker / template selector
  2. Inbox with an AI reply going out
  3. Voice call in progress (the call modal)
  4. Routing rules in plain English
  5. The "Recommended for your setup" integrations page after install
- **App icon**: square Xovera wordmark at 512×512 (the marketplace usually requires PNG, no transparency in some categories).
