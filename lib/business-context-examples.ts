/**
 * Starter Business Context glossaries for the Advanced-agent textarea.
 *
 * Pure strings — no DB, no server-only imports — so the dashboard client
 * components can import this without pulling the whole lib graph into
 * the browser bundle. Add more industries here and they'll show up in
 * the "Insert example" picker wherever it's rendered.
 */

export interface BusinessContextExample {
  id: string
  label: string
  description: string
  body: string
}

// Each body uses merge fields with fallbacks ({{contact.first_name|the
// contact}}, {{custom.budget_cap|not disclosed}}, etc.) to show operators
// that tokens resolve inside the glossary itself — not just pre-written
// messages. At runtime, these get rendered against the live contact + user
// before the block hits the LLM, so the agent sees real names/values.
export const BUSINESS_CONTEXT_EXAMPLES: BusinessContextExample[] = [
  {
    id: 'car-dealer',
    label: 'Used car dealership',
    description: 'Opportunities = vehicles inquired about. Vehicle specs on custom fields.',
    body: `We are a used car dealership. Each opportunity is a specific vehicle the contact has inquired about — a single contact will usually have 2–5 active opportunities as they compare options. monetaryValue is the listed sale price in USD (not the negotiated price).

You are speaking with {{contact.first_name|the contact}}. Their stated budget is {{custom.budget_cap|not disclosed}} and their preferred body style is {{custom.preferred_body_style|no preference yet}}. Their assigned salesperson is {{user.name|our team}} ({{user.phone|call the showroom}}).

Custom fields on opportunities describe the vehicle:
- vehicle_stock_id: our internal stock number (always starts with "S-")
- vehicle_make, vehicle_model, vehicle_year: self-explanatory
- vehicle_color, vehicle_miles: self-explanatory

Contact-level custom fields:
- budget_cap: contact's max budget in USD
- preferred_body_style: sedan / SUV / truck / wagon
- trade_in_vehicle: free-text description of what they're trading

Pipeline stages (in order): New Inquiry → Viewing Scheduled → Viewed → Test Drive Scheduled → Test Driven → Offer Made → Financing → Sold. A "lost" opportunity means they went elsewhere or passed on it. A "won" opportunity is a completed sale.

When the contact says "that truck", "the red one", "the silver RAV4", etc., cross-reference their active inquiries and pick the match. If they ask about a vehicle not in their active inquiries, call search_opportunities to see if it's in stock. If {{contact.first_name|the contact}} asks about financing, hand them to {{user.name|their salesperson}} directly.`,
  },
  {
    id: 'b2b-saas',
    label: 'B2B SaaS sales',
    description: 'Opportunities = deals at different stages. Seat count and tier on custom fields.',
    body: `We sell a team productivity SaaS on monthly and annual plans. Each opportunity is a deal in a specific pipeline stage; monetaryValue is the annualised contract value in USD.

You are speaking with {{contact.first_name|the contact}}{{contact.company| from }}{{contact.company|}}. Their account executive is {{user.name|the AE team}} ({{user.email|via our sales inbox}}). Their role is {{custom.role|a decision-maker}}, and they are currently using {{custom.current_tool|no similar tool}}.

Opportunity custom fields:
- seat_count: number of user licences being discussed
- plan_tier: "Starter", "Pro", or "Enterprise"
- contract_length_months: typically 12 or 36
- primary_use_case: the main workflow they want to solve

Contact custom fields:
- role: usually "Founder", "Ops Manager", or "VP Engineering"
- company_size_band: 1-10, 11-50, 51-200, 201+
- current_tool: what they're using today (often Asana, Monday, or none)

Stages: Discovery → Demo Scheduled → Demo Done → Proposal Sent → Verbal Yes → Legal Review → Signed. Lost usually means they went with a competitor (logged in current_tool on close).

If {{contact.first_name|the contact}} references "the proposal", check for an opportunity in stage Proposal Sent and cite its monetaryValue + contract_length_months. If they're weighing tiers, the plan_tier field tells you which one they're considering on each open deal. Procurement or legal questions go to {{user.name|their AE}}.`,
  },
  {
    id: 'trades',
    label: 'Trades / quote-based service',
    description: 'Opportunities = itemised quotes. Job specs and address on custom fields.',
    body: `We're a residential plumbing contractor. Opportunities are itemised quotes — monetaryValue is the total quoted price in USD including GST.

You are speaking with {{contact.first_name|the customer}} at {{contact.city|their property}}. Their preferred contact window is {{custom.preferred_contact_window|business hours}}, their property type is {{custom.property_type|residential}}, and access notes on file: {{custom.access_notes|none}}. Their scheduler is {{user.name|the dispatch team}} ({{user.phone|call the office}}).

Opportunity custom fields:
- job_type: "Emergency", "Renovation", "Maintenance", "New install"
- address: service address (not always the contact's home address)
- materials_cost: parts-only portion of the total
- labour_hours_estimated: our crew time estimate

Contact custom fields:
- preferred_contact_window: contact-provided time they want a call
- access_notes: keys, gate codes, dogs, parking — free text the tech needs before arrival
- property_type: "House", "Apartment", "Commercial"

Stages: Quote Requested → Quoted → Quote Accepted → Scheduled → In Progress → Complete → Invoice Sent → Paid. A "lost" opportunity means they went with another quote.

When {{contact.first_name|the customer}} references "the quote" or "the bathroom job", pick the most recently quoted opportunity. If they ask for a timeline, check the stage first — "Scheduled" opportunities have an associated appointment you can look up. Emergency jobs get routed to {{user.name|the dispatcher}} immediately.`,
  },
  {
    id: 'real-estate',
    label: 'Real estate agent',
    description: 'Opportunities = properties shown. Listing details on custom fields.',
    body: `We are a residential real estate agency. Each opportunity is a property the contact has expressed interest in — they usually shortlist 3–6 at a time. monetaryValue is the listed asking price in USD.

You are speaking with {{contact.first_name|the contact}} ({{custom.buyer_type|a buyer}}) working with agent {{user.name|our team}} ({{user.phone|call our office}}). Their approved budget is {{custom.budget_min|undisclosed}}–{{custom.budget_max|flexible}}, closing within {{custom.timeline_months|no set}} months. Must-haves on file: {{custom.must_haves|none listed}}.

Opportunity custom fields:
- mls_id: our listing reference number
- bedrooms, bathrooms: self-explanatory
- sqft: interior square footage
- address: full property address
- listing_type: "For Sale", "For Rent", "Off-Market"
- price_band: "Under $500k", "$500k-$1M", "$1M-$2M", "$2M+"

Contact-level custom fields:
- buyer_type: "First-time", "Upgrading", "Investor", "Relocation"
- budget_min, budget_max: range they've been pre-approved for
- timeline_months: how many months until they want to close
- must_haves: free-text dealbreakers ("dog-friendly", "home office", etc.)

Stages: Viewing Requested → Viewed → Offer Drafted → Offer Submitted → Under Contract → Closed Won. Lost usually means they bought elsewhere or withdrew.

When {{contact.first_name|the contact}} says "that 3-bedroom" or "the colonial on Oak Street", cross-reference address/bedrooms in their active inquiries. If they ask about properties outside their current shortlist, use the MLS lookup tool. Offer strategy questions go to {{user.name|their agent}}.`,
  },
]
