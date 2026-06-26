# Xovera Help Center

> A complete set of help-center articles ready to drop into your knowledge base.
> The Shopify section is the focus of this document; other product areas are
> listed as section stubs so the overall structure of the help centre is clear.

---

## Table of contents

**Getting started**
- Welcome to Xovera
- Creating your first agent

**Integrations**
- Connecting your CRM
- Connecting Facebook & Instagram DMs

**Shopify (dedicated section)** — see below

**Channels**
- The chat widget
- Voice
- SMS & WhatsApp

**Account & billing**
- Workspaces & team members
- Plans & limits

---

# Shopify

> Make your agent inventory-aware, order-aware, and customer-aware. Once your
> Shopify store is connected, your agent can answer "do you have X in stock?",
> share live tracking, create checkout links, mint discount codes, and DM
> customers automatically when sold-out items come back.

## In this section

1. [What the Shopify integration does](#article-what-the-shopify-integration-does)
2. [Connecting your Shopify store](#article-connecting-your-shopify-store)
3. [Setting up Shopify scopes (one-time)](#article-setting-up-shopify-scopes-one-time)
4. [What your agent can do once Shopify is connected](#article-what-your-agent-can-do-once-shopify-is-connected)
5. [Rich product cards in chat](#article-rich-product-cards-in-chat)
6. [Personalised replies for repeat customers](#article-personalised-replies-for-repeat-customers)
7. [Sending checkout links in chat](#article-sending-checkout-links-in-chat)
8. [Discount codes from chat](#article-discount-codes-from-chat)
9. [Back-in-stock notifications](#article-back-in-stock-notifications)
10. [Disconnecting or reconnecting Shopify](#article-disconnecting-or-reconnecting-shopify)
11. [Troubleshooting](#article-troubleshooting-shopify)

---

## Article: What the Shopify integration does

Connecting your Shopify store unlocks **live commerce awareness** for every
agent in your workspace. Once connected, your agent can:

- **Look up products** by name, type, vendor, tag, or SKU — and quote real prices, sizes, colours, and stock levels.
- **Check inventory** for specific variants, broken down per fulfilment location.
- **Find a customer** by email or phone and read their lifetime spend, recent orders, and tags.
- **Look up order status** for "where's my order?" questions, including live fulfilment + tracking.
- **Create a one-tap checkout** with specific items pre-loaded.
- **Mint a real discount code** on the fly.
- **Capture "notify me when back in stock"** interest and DM the customer automatically when stock returns.

The agent never invents product details. If it doesn't have a tool result to
back up a claim, it asks rather than guessing.

**Where this matters most:** Facebook & Instagram DMs, your live chat widget,
and any voice or SMS conversation where a customer asks about your store.

---

## Article: Connecting your Shopify store

Your Shopify connection lives at the **workspace** level — one store per
workspace. Every agent in that workspace shares access. Each individual agent
can have specific Shopify capabilities turned on or off via its tool settings,
but the connection itself is one per workspace.

### Steps

1. Open **Integrations** in your Xovera dashboard.
2. Find the **Shopify** card.
3. Type your shop domain (either `yourstore` or `yourstore.myshopify.com` — we'll add the rest if you only type the name).
4. Click **Connect**. You'll be sent to Shopify to authorise the install.
5. On Shopify's authorisation screen, review the requested permissions and click **Install**.
6. You'll land back on the Integrations page. The Shopify card now shows **Connected** with your shop domain.

That's it. Test by opening the **Playground** and asking "do you have any [product type] in stock?" — your agent should query the catalogue and reply with real products.

### A heads-up about scopes

The first time you set up the Shopify app for Xovera, you'll need to declare
which permissions ("access scopes") the app requests. See the next article for
the one-time setup if you're seeing scope-related errors.

---

## Article: Setting up Shopify scopes (one-time)

If your agent says "I'm having trouble accessing our live inventory system"
or you see errors mentioning **"Access denied for products field"**, the app's
access scopes haven't been configured yet. This is a one-time setup in
Shopify's Dev Dashboard.

### What scopes does Xovera need?

```
read_products, read_inventory, read_orders, write_draft_orders,
read_customers, write_customers, read_fulfillments, read_returns,
read_price_rules, write_discounts
```

- The `read_` scopes let the agent look things up.
- The `write_draft_orders` scope lets the agent create checkout links.
- The `write_discounts` scope lets the agent mint discount codes.
- The `write_customers` scope lets the agent update customer tags when relevant.

### Where to add them

1. Open your Shopify Partner account.
2. Go to your Xovera app's **Dev Dashboard**.
3. Find the section called **Versions** (this is where access scopes for newer Shopify apps live).
4. Add the scopes listed above.
5. **Release** the new version so the changes go live.
6. Back in your Shopify store admin, uninstall the Xovera app, then reconnect from Xovera's Integrations page.

The uninstall + reinstall is necessary so Shopify can show the consent screen
listing the scopes for you to approve. Without re-installing, the previous
token's permissions stay in effect.

### After reconnecting

Test again in the playground. The agent should now successfully call the
Shopify tools when relevant.

---

## Article: What your agent can do once Shopify is connected

Your agent gets seven new capabilities ("reflexes") when Shopify is connected.
Each one can be turned on or off per agent in **Agent settings → Tools**.

### Read-only (looking things up)

- **Search products** — free-text search across your catalogue. Returns name, prices, stock, and variants.
- **Check inventory** — precise stock count for a specific variant, by fulfilment location.
- **Look up a customer** — find a customer by email or phone. Returns lifetime spend, order count, tags, and recent orders.
- **Check order status** — look up an order by number ("#1042"), get fulfilment status + tracking.

### Actions (changing things)

- **Create a checkout link** — build a one-tap Shopify checkout with specific items pre-loaded.
- **Create a discount code** — mint a real Shopify discount code on the fly.
- **Capture back-in-stock interest** — save the customer's interest in an out-of-stock variant for automatic follow-up.

### Sensible defaults

When you create a new agent in a Shopify-connected workspace, all seven of
these are enabled by default. You can disable any of them per-agent — for
example, you might want a post-purchase support agent to be able to check
orders but not create discounts.

---

## Article: Rich product cards in chat

When your agent recommends a specific product in the chat widget, the customer
doesn't see a plain text link — they see a **tappable card** with the product
image, title, price, and a **View product** button.

### How it works

- The agent searches your Shopify catalogue (or already has results from earlier in the conversation).
- When it recommends a particular product, it appends a special marker to its reply that says "show this product as a card."
- The widget renders the card. The customer taps **View product** to land directly on the product page in your store.

### Which channels support cards?

- **Chat widget** — yes (today).
- **Facebook & Instagram DMs, SMS, voice** — not yet. The agent's reply gets the marker stripped automatically, and the customer sees text + a plain product link. We're working on rich cards for those channels.

### Behind the scenes

Cards are limited to 3 per reply so the conversation stays readable. The agent
picks the best 1–3 products to highlight rather than dumping a long list — if
you want broader browsing, the agent suggests a category instead.

---

## Article: Personalised replies for repeat customers

When a customer DMs your store, your agent automatically looks them up in
Shopify by their email or phone (if known) **before** replying. The agent
sees a brief profile in its system prompt: name, lifetime spend, order count,
tags, and the 3 most recent orders with line items + fulfilment status.

### Why this matters

A first-time visitor and a $1,000-lifetime-value repeat customer should get
different replies. Without context the agent has to ask "have you ordered
before?"; with context it can open with "Welcome back — I see your last order
shipped on Tuesday, what's up?"

### Where the customer email/phone comes from

Your CRM (HighLevel, HubSpot, the native CRM, or the Meta DM sender). If
Xovera doesn't have an email or phone for the contact yet, the lookup is
skipped and the agent treats them as a new customer — never inventing past
purchases.

### What the agent will not do

- Recite the full profile back at the customer (that would feel like a surveillance moment).
- Mention specific past orders the customer didn't bring up first.
- Invent or assume purchase history.

The context is for **tone** and **reference**, not a script to read aloud.

---

## Article: Sending checkout links in chat

When a customer decides what they want, your agent can build a **Shopify
checkout link** and send it directly in chat. The customer taps the link,
lands on Shopify's hosted checkout with the items pre-loaded, and pays.

### What the customer sees

A message like:
> "Perfect — I've got the Black Tote in Medium ready for you. Here's your secure checkout: [link]"

The link goes to a normal Shopify checkout page. The customer's payment is
handled entirely by Shopify (we never see card details).

### Optional extras

The agent can:
- Pre-fill the customer's email so they don't have to re-type it.
- Apply a discount code if appropriate.
- Add an internal note visible to your team in the Shopify draft order.

### When the agent will use this

- Customer confirms what they want to buy ("yes, the medium black one")
- Customer asks for a direct checkout ("can you send me the link?")
- Cart recovery flow (you build this manually as a play — coming soon as an out-of-the-box feature)

If the agent hasn't confirmed the variant + quantity yet, it will ask first
before generating a link.

---

## Article: Discount codes from chat

Your agent can mint a **real Shopify discount code** on the fly during a
conversation — useful for save-the-sale moments, loyalty thank-yous, win-back
DMs, or first-purchase nudges.

### How discounts are generated

The agent picks a short memorable code (e.g. `HELLO10`), a value (5–15% off
by default), an expiry (24–72 hours by default), and creates it in your
Shopify store. The code shows up in your store's **Discounts** section
immediately.

### Built-in guardrails

- **Hard cap: 50% off (percentage) or $200 (fixed amount).** The agent cannot mint deeper discounts than this without an authorised override. This stops a jailbroken prompt from creating a 100%-off code.
- **Default single-use.** Codes are single-redemption unless explicitly configured for more.
- **Default 72-hour expiry.** Codes don't linger indefinitely.

### Customising the discount policy

If you want a stricter or looser policy for a specific agent (e.g. "this
post-purchase agent can never mint discounts" or "this VIP concierge can mint
up to 25%"), disable or constrain the discount tool in **Agent settings →
Tools**.

### Tracking codes generated

Every code shows in your Shopify admin under Discounts, with usage stats. Most
operators leave a tag on agent-generated codes so they're easy to filter.

---

## Article: Back-in-stock notifications

When a customer asks about an item that's sold out, your agent can capture
their interest. When stock returns, Xovera **automatically DMs them**
without you having to do anything.

### How it works

1. Customer in the widget: "Do you have the wool beanie in grey?"
2. Agent checks inventory: sold out.
3. Agent: "Sorry, the grey wool beanie is sold out right now. Want me to DM you here as soon as it's back?"
4. Customer: "Yes please"
5. Agent calls the back-in-stock tool, recording the interest.
6. (Days later) You restock the variant in Shopify.
7. Shopify fires an inventory update webhook to Xovera.
8. Xovera sends a message to the same chat: *"Good news — the grey wool beanie is back in stock! You can grab it here: [link]"*

### Channel support

- **Chat widget** — supported today.
- **Facebook, Instagram, SMS** — not yet. The agent will offer to take an email so your team can follow up manually. We're working on automated outbound for these channels.

### Tracking interest signals

In your dashboard you'll be able to see active back-in-stock signals per shop
(in development). For now, every signal is recorded with the conversation it
came from, so support agents can drill in if needed.

---

## Article: Disconnecting or reconnecting Shopify

### Disconnecting

1. Open **Integrations** in your Xovera dashboard.
2. On the Shopify card, click **Disconnect**.
3. Confirm.

Your agents will lose the Shopify capabilities immediately. Your data on
Shopify is untouched — disconnecting only pauses our access. You can reconnect
at any time.

> **Note:** Disconnecting from Xovera does **not** uninstall the app on the
> Shopify side. The app stays installed in your Shopify admin but Xovera
> stops calling it. To fully uninstall (revoke our access entirely), uninstall
> from your Shopify store's **Settings → Apps and sales channels**.

### Reconnecting

Click **Connect** on the Shopify card and complete the same install flow as
before. Your previous data (back-in-stock signals, etc.) is preserved.

### What happens when a token expires

Shopify's access tokens last 1 hour and refresh automatically. You shouldn't
ever notice — Xovera refreshes 5 minutes before expiry. If a refresh fails
(e.g. you uninstalled from Shopify directly), the integration shows as
disconnected and you'll need to reconnect.

---

## Article: Troubleshooting Shopify

### "Connected" but agent says it can't access live inventory

The most common cause is missing scopes on the Shopify app. See
[Setting up Shopify scopes](#article-setting-up-shopify-scopes-one-time). If
scopes are set but you're still seeing this, check the agent's enabled tools
in **Agent settings → Tools** and confirm the four Shopify reflexes are on.

### "Access denied for products field"

The OAuth install completed but Shopify didn't grant the `read_products`
scope. Fix the scopes in the Dev Dashboard (per the scopes article), uninstall
the app from Shopify, then reconnect from Xovera's Integrations page.

### "Non-expiring access tokens are no longer accepted"

Shopify upgraded their security model in December 2025 — older non-expiring
tokens are no longer honoured. Xovera now requests expiring tokens
automatically; you just need to uninstall + reconnect once to get the new
token shape. If you're still seeing this after reconnecting, contact support.

### "The customer asked about a product but the agent hallucinated"

This shouldn't happen with Shopify connected — the agent's system prompt
explicitly forbids inventing product details and instructs it to use the
search tool first. If you see it:

1. Confirm the agent's Shopify tools are enabled (Agent settings → Tools).
2. Confirm the connection is healthy (Integrations page shows Connected, no warning banner).
3. Open the playground and ask the same question. Watch for the `search_shopify_products` tool call appearing in the transcript — if it doesn't appear, the agent isn't trying to use the tool.
4. If the tool runs but returns no results, check that your Shopify catalogue actually contains a product matching the query — the agent reports honestly when nothing matches.

If all four pass and the agent still hallucinates, contact support with a
transcript and we'll investigate.

### "I disconnected Shopify but my agents are still trying to use it"

Disconnecting takes effect immediately for new conversations. In-flight
conversations (where the agent is actively replying) may complete the current
reply using the previous connection. The next reply will reflect the
disconnection.

### "Custom apps aren't an option in my Shopify admin"

Shopify deprecated legacy custom apps in January 2026. Use Xovera's OAuth
install flow (the Connect button on the Integrations page) instead — that's
the supported path going forward.

### "Why is the back-in-stock DM not landing?"

Three things to check:

1. **The interest signal exists.** Open the conversation that asked about the variant and look for the agent's "I'll let you know when it's back" message. If you don't see it, the agent didn't successfully record the signal.
2. **The webhook is registered.** This happens automatically when you connect Shopify, but if you connected before our latest update, you may need to reconnect once.
3. **Stock actually crossed zero.** The inventory webhook fires on every change but we only DM when the available count goes from zero to positive. If the variant never hit zero, no notification fires.

If all three check out and the DM still doesn't land, contact support.

---

# Other integrations (section stubs)

These sections exist in the help centre but aren't included in this document.
Drop in the appropriate articles for your tooling.

## CRM (HighLevel, HubSpot, Native)
- Connecting your CRM
- Switching CRMs
- What context your agent pulls from the CRM

## Facebook & Instagram DMs
- Connecting Meta
- Routing inbound DMs to the right agent
- Handover to a human

## Voice
- Setting up voice AI
- Inbound call handling
- Call transcripts

## SMS & WhatsApp
- Setting up Twilio
- WhatsApp Business
- Compliance & opt-outs

---

# Managing your account (section stubs)

## Workspaces & team members
## Plans & limits
## Billing
