import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function main() {
  console.log('Creating Stripe products and prices for Voxility...\n')

  // ── 1. Base subscription products ──────────────────────────────────

  const starter = await stripe.products.create({
    name: 'Voxility Starter',
    description: '3 AI agents, 1,500 messages/mo, SMS + Email + Live Chat',
    metadata: { plan: 'starter' },
  })
  console.log(`✓ Product: ${starter.name} (${starter.id})`)

  const starterMonthly = await stripe.prices.create({
    product: starter.id,
    unit_amount: 29700, // $297.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'starter', period: 'monthly' },
  })
  console.log(`  Monthly: $297/mo (${starterMonthly.id})`)

  const starterAnnual = await stripe.prices.create({
    product: starter.id,
    unit_amount: 24700, // $247.00/mo billed annually
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { plan: 'starter', period: 'annual' },
  })
  console.log(`  Annual:  $247/mo billed yearly (${starterAnnual.id})`)

  // ──

  const growth = await stripe.products.create({
    name: 'Voxility Growth',
    description: '5 AI agents, 5,000 messages/mo, all channels, Voice AI (60 min), lead scoring',
    metadata: { plan: 'growth' },
  })
  console.log(`\n✓ Product: ${growth.name} (${growth.id})`)

  const growthMonthly = await stripe.prices.create({
    product: growth.id,
    unit_amount: 49700, // $497.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'growth', period: 'monthly' },
  })
  console.log(`  Monthly: $497/mo (${growthMonthly.id})`)

  const growthAnnual = await stripe.prices.create({
    product: growth.id,
    unit_amount: 41400, // $414.00/mo billed annually
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { plan: 'growth', period: 'annual' },
  })
  console.log(`  Annual:  $414/mo billed yearly (${growthAnnual.id})`)

  // ──

  const scale = await stripe.products.create({
    name: 'Voxility Scale',
    description: '15 AI agents, 15,000 messages/mo, all channels + tools, Voice AI (200 min), unlimited team',
    metadata: { plan: 'scale' },
  })
  console.log(`\n✓ Product: ${scale.name} (${scale.id})`)

  const scaleMonthly = await stripe.prices.create({
    product: scale.id,
    unit_amount: 99700, // $997.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'scale', period: 'monthly' },
  })
  console.log(`  Monthly: $997/mo (${scaleMonthly.id})`)

  const scaleAnnual = await stripe.prices.create({
    product: scale.id,
    unit_amount: 83100, // $831.00/mo billed annually
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { plan: 'scale', period: 'annual' },
  })
  console.log(`  Annual:  $831/mo billed yearly (${scaleAnnual.id})`)

  // ── 2. Metered overage prices ──────────────────────────────────────

  const messageOverageProduct = await stripe.products.create({
    name: 'Voxility Message Overage',
    description: 'Per-message overage beyond plan inclusion',
    metadata: { type: 'overage', resource: 'message' },
  })
  console.log(`\n✓ Product: ${messageOverageProduct.name} (${messageOverageProduct.id})`)

  const messageOverage = await stripe.prices.create({
    product: messageOverageProduct.id,
    unit_amount: 4, // $0.04
    currency: 'usd',
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      meter: undefined,
    },
    metadata: { type: 'message_overage' },
  })
  console.log(`  $0.04/message (${messageOverage.id})`)

  const voiceOverageProduct = await stripe.products.create({
    name: 'Voxility Voice Overage',
    description: 'Per-minute voice overage beyond plan inclusion',
    metadata: { type: 'overage', resource: 'voice' },
  })
  console.log(`\n✓ Product: ${voiceOverageProduct.name} (${voiceOverageProduct.id})`)

  const voiceOverage = await stripe.prices.create({
    product: voiceOverageProduct.id,
    unit_amount: 18, // $0.18
    currency: 'usd',
    recurring: {
      interval: 'month',
      usage_type: 'metered',
      meter: undefined,
    },
    metadata: { type: 'voice_overage' },
  })
  console.log(`  $0.18/minute (${voiceOverage.id})`)

  // ── 3. Extra agent add-on ──────────────────────────────────────────

  const extraAgentProduct = await stripe.products.create({
    name: 'Voxility Extra Agent',
    description: 'Additional AI agent slot (quantity-based)',
    metadata: { type: 'addon', resource: 'agent' },
  })
  console.log(`\n✓ Product: ${extraAgentProduct.name} (${extraAgentProduct.id})`)

  const extraAgent = await stripe.prices.create({
    product: extraAgentProduct.id,
    unit_amount: 3900, // $39.00 (Growth-tier default, reasonable middle)
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { type: 'extra_agent' },
  })
  console.log(`  $39/agent/mo (${extraAgent.id})`)

  // ── Output env variables ───────────────────────────────────────────

  console.log('\n\n════════════════════════════════════════════════════════')
  console.log('  Add these to your .env / .env.local:')
  console.log('════════════════════════════════════════════════════════\n')

  const envVars = `# Stripe — Voxility Billing
STRIPE_SECRET_KEY=${process.env.STRIPE_SECRET_KEY}
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME

# Subscription prices
STRIPE_PRICE_STARTER_MONTHLY=${starterMonthly.id}
STRIPE_PRICE_STARTER_ANNUAL=${starterAnnual.id}
STRIPE_PRICE_GROWTH_MONTHLY=${growthMonthly.id}
STRIPE_PRICE_GROWTH_ANNUAL=${growthAnnual.id}
STRIPE_PRICE_SCALE_MONTHLY=${scaleMonthly.id}
STRIPE_PRICE_SCALE_ANNUAL=${scaleAnnual.id}

# Metered overage prices
STRIPE_PRICE_MESSAGE_OVERAGE=${messageOverage.id}
STRIPE_PRICE_VOICE_OVERAGE=${voiceOverage.id}

# Add-on prices
STRIPE_PRICE_EXTRA_AGENT=${extraAgent.id}`

  console.log(envVars)
  console.log('')
}

main().catch(err => {
  console.error('Failed:', err.message)
  process.exit(1)
})
