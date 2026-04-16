import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

async function main() {
  console.log('Creating metered billing (meters + prices) and extra agent add-on...\n')

  // ── 1. Create Billing Meters ───────────────────────────────────────

  const messageMeter = await stripe.billing.meters.create({
    display_name: 'AI Messages',
    event_name: 'voxility_message',
    default_aggregation: { formula: 'sum' },
  })
  console.log(`✓ Meter: AI Messages (${messageMeter.id})`)

  const voiceMeter = await stripe.billing.meters.create({
    display_name: 'Voice Minutes',
    event_name: 'voxility_voice_minute',
    default_aggregation: { formula: 'sum' },
  })
  console.log(`✓ Meter: Voice Minutes (${voiceMeter.id})`)

  // ── 2. Create metered prices backed by meters ──────────────────────

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
      meter: messageMeter.id,
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
      meter: voiceMeter.id,
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
    unit_amount: 3900, // $39.00
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { type: 'extra_agent' },
  })
  console.log(`  $39/agent/mo (${extraAgent.id})`)

  // ── Output ─────────────────────────────────────────────────────────

  console.log('\n\n════════════════════════════════════════════════════════')
  console.log('  Remaining env vars (add to those from run 1):')
  console.log('════════════════════════════════════════════════════════\n')

  console.log(`# Metered overage prices`)
  console.log(`STRIPE_PRICE_MESSAGE_OVERAGE=${messageOverage.id}`)
  console.log(`STRIPE_PRICE_VOICE_OVERAGE=${voiceOverage.id}`)
  console.log(``)
  console.log(`# Add-on prices`)
  console.log(`STRIPE_PRICE_EXTRA_AGENT=${extraAgent.id}`)
  console.log(``)
  console.log(`# Billing Meter IDs (for reporting usage)`)
  console.log(`STRIPE_METER_MESSAGE=${messageMeter.id}`)
  console.log(`STRIPE_METER_VOICE=${voiceMeter.id}`)
  console.log('')
}

main().catch(err => {
  console.error('Failed:', err.message)
  process.exit(1)
})
