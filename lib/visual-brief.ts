/**
 * Pre-spec visual brief generator.
 *
 * Before Claude composes the page (vsl-generator), this pass decides
 * what visual building blocks the page needs. Hero subject, illustration
 * concepts, icon picks for benefits/features/pain points, the overall
 * motif. The output then drives:
 *   - lib/page-assets.ts: actually generates hero + illustrations via
 *     Replicate Flux 1.1 Pro Ultra
 *   - lib/vsl-generator.ts: composes the spec USING those assets
 *     (sections reference icons/illustrations explicitly)
 *
 * This is the "designer's mood board" step the build loop was missing.
 * Without it Claude composed text-heavy pages and hero photo got slapped
 * on top after the fact — every page looked the same. Visual-first
 * flow lets the designer-LLM think about look-and-feel before words.
 */

import Anthropic from '@anthropic-ai/sdk'
import { LUCIDE_ALLOWLIST, pickAllowedIcon, type LucideIconName } from './lucide-allowlist'
import type { BrandKit, CampaignIntake } from './vsl-generator'

const client = new Anthropic()
const MODEL = 'claude-sonnet-4-6'

export interface VisualBriefIcon {
  /** Where this icon goes in the spec. Examples:
   *  'pain-1' .. 'pain-3' for ProblemSection.pains
   *  'mechanism-step-1' .. for MechanismSection.steps
   *  'offer-item-1' .. for OfferSection.items                     */
  role: string
  /** Lucide icon name from the allowlist. Always validated post-hoc;
   *  hallucinations get coerced or dropped. */
  name: LucideIconName
  /** Short label for accessibility / fallback display. */
  label: string
  /** One-line reason this icon was picked (logged, not rendered). */
  rationale?: string
}

export interface VisualBriefIllustration {
  /** Where in the page the illustration lives:
   *  'problem' — visualises the pain / before-state
   *  'mechanism' — visualises how the offer works
   *  'proof' — supporting visual for testimonials/stats             */
  role: 'problem' | 'mechanism' | 'proof'
  /** What the illustration depicts in 1-2 sentences. Concrete and
   *  specific to THIS offer — not generic. */
  concept: string
  /** Imagen-style prompt seed. The asset generator wraps this with
   *  brand context + style modifiers; the brief just supplies the
   *  what, the generator handles the how. */
  prompt_seed: string
}

export interface VisualBrief {
  /** Top-level visual mood for the page. 1-2 sentence designer brief. */
  mood: string
  /** Hero subject. The asset generator turns this into the Replicate
   *  prompt for the full-bleed hero photo. */
  hero_concept: string
  hero_prompt_seed: string
  /** 1-3 supporting illustrations. Costly (~$0.06 each on Replicate)
   *  but transformative — pages stop looking like text-on-white. */
  illustrations: VisualBriefIllustration[]
  /** 6-12 icon picks for benefits, pains, mechanism steps, offer items.
   *  Free, instant, and visually consistent. */
  icons: VisualBriefIcon[]
}

const SYSTEM_PROMPT = `You are an art director designing the visual concept for a high-converting direct-response landing page. Your output drives an asset-generation pipeline (Replicate Flux 1.1 Pro Ultra for photos/illustrations, Lucide icon library for UI iconography) that produces the building blocks the page composer will use.

Your job is NOT to write copy. It's to decide what the page should LOOK like.

Output a complete visual brief via the visual_brief tool:

1. **mood** — 1-2 sentences. The overall design feel. Example: "Editorial, confident, slightly futuristic — direct-response polish without the screamy direct-response cheese." Match the brand analysis if one is provided; if not, infer from the offer + audience.

2. **hero_concept** — what the hero photo depicts. Concrete, specific to this offer. NOT "people working" or "diverse team smiling". Examples that work: "Founder's hands stacking gold coins, dramatic side-light." "Single laptop on a bare desk, screen showing a pulsing dashboard, dawn light through window." "A woman mid-laugh at her own dinner table holding a glass of wine — the dream outcome made visible." Forbidden compositions: people gathered around a laptop, meeting rooms, handshakes, finger-pointing at screens, three-people-smiling stock-photo clichés.

3. **hero_prompt_seed** — the literal prompt fragment that goes to Replicate. Should describe the scene + lighting + mood, but NOT include style modifiers (the asset generator adds those). Example: "A pair of weathered hands gripping a worn leather journal at golden-hour, intimate close-up, shallow depth of field, brand-orange accent in the journal binding."

4. **illustrations** — 1-3 supporting illustrations, one each for problem / mechanism / proof. Pick which sections benefit from a custom illustration based on the offer:
   - B2B/SaaS: usually mechanism (process diagram) and problem (before-state)
   - Coaching/services: problem (pain visualisation) and proof (transformation)
   - Physical products: mechanism (how-it-works) and proof (in-use)
   - Skip illustrations on sections that work fine with icons alone (e.g. simple offer with 4 features → just icons)
   Each illustration: role (which section), concept (1-2 sentences, visual + emotional), prompt_seed.

5. **icons** — 6-12 Lucide icon picks. You MUST only pick names from this allowlist:
${LUCIDE_ALLOWLIST.join(', ')}

   Each icon entry has:
   - role: where in the spec it lives. Use these exact role keys:
       'pain-1', 'pain-2', 'pain-3' — pain points in the Problem section
       'mechanism-step-1', 'mechanism-step-2', 'mechanism-step-3', 'mechanism-step-4' — Mechanism steps
       'offer-item-1' .. 'offer-item-6' — Offer feature/benefit items
       'guarantee' — Guarantee badge icon
       'urgency' — Urgency strip icon
   - name: kebab-case Lucide name from the allowlist
   - label: short human label for the item (e.g. "Speed", "Security")
   - rationale: why this icon (1 line, optional)

   Pick icons that are SPECIFIC to the offer. "shield" for security claims, "clock" for time savings, "trending-up" for growth, "wand-sparkles" for AI-magic features. Don't default to generic "check" everywhere.

Tone for the whole brief: a senior art director briefing a photo shoot. Specific. Concrete. Avoid abstractions like "modern" or "innovative" — pick a noun ("a barista pouring espresso", "a violinist's hands on the bow") even when the offer is conceptual.`

const TOOL_SCHEMA = {
  type: 'object' as const,
  required: ['mood', 'hero_concept', 'hero_prompt_seed', 'illustrations', 'icons'],
  properties: {
    mood: { type: 'string', maxLength: 400 },
    hero_concept: { type: 'string', maxLength: 400 },
    hero_prompt_seed: { type: 'string', maxLength: 600 },
    illustrations: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['role', 'concept', 'prompt_seed'],
        properties: {
          role: { type: 'string', enum: ['problem', 'mechanism', 'proof'] },
          concept: { type: 'string', maxLength: 400 },
          prompt_seed: { type: 'string', maxLength: 500 },
        },
      },
    },
    icons: {
      type: 'array',
      maxItems: 14,
      items: {
        type: 'object',
        required: ['role', 'name', 'label'],
        properties: {
          role: { type: 'string', maxLength: 40 },
          name: { type: 'string', maxLength: 40 },
          label: { type: 'string', maxLength: 60 },
          rationale: { type: 'string', maxLength: 140 },
        },
      },
    },
  },
}

export async function generateVisualBrief(args: {
  intake: CampaignIntake
  brand_kit?: BrandKit
  primary_color: string
  /** When this is iteration 2+, we feed the previous critique's
   *  imagery-related complaints back in so the brief regenerates
   *  visually instead of cosmetically. */
  revision_brief?: string
}): Promise<VisualBrief> {
  const intakeBits = [
    `Business: ${args.intake.business_name}`,
    `Offer: ${args.intake.offer}`,
    `Dream outcome: ${args.intake.dream_outcome}`,
    args.intake.false_belief ? `False belief: ${args.intake.false_belief}` : '',
    args.intake.mechanism ? `Mechanism: ${args.intake.mechanism}` : '',
    args.intake.proof ? `Proof: ${args.intake.proof}` : '',
    args.intake.audience ? `Audience: ${args.intake.audience}` : '',
    args.intake.industry ? `Industry: ${args.intake.industry}` : '',
    `Brand colour: ${args.primary_color}`,
  ].filter(Boolean).join('\n')

  const brandBits: string[] = []
  if (args.brand_kit?.analysis) {
    const a = args.brand_kit.analysis
    brandBits.push(`Brand identity (extracted from operator's site):`)
    if (a.design_vibe) brandBits.push(`  - design vibe: ${a.design_vibe}`)
    if (a.photography_style) brandBits.push(`  - photography style: ${a.photography_style}`)
    if (a.voice_tone) brandBits.push(`  - voice tone: ${a.voice_tone}`)
    if (a.visual_motifs && a.visual_motifs.length > 0) brandBits.push(`  - visual motifs: ${a.visual_motifs.join(', ')}`)
    if (a.industry_guess) brandBits.push(`  - industry: ${a.industry_guess}`)
  }
  if (args.brand_kit?.brand_guide_text) {
    brandBits.push(`Brand guide notes:\n${args.brand_kit.brand_guide_text.slice(0, 600)}`)
  }

  const userText = [
    'Generate the visual brief for this landing page.',
    '',
    'CAMPAIGN:',
    intakeBits,
    brandBits.length > 0 ? `\n${brandBits.join('\n')}` : '',
    args.revision_brief ? `\nREVISION GUIDANCE FROM PREVIOUS ITERATION:\n${args.revision_brief}` : '',
  ].filter(Boolean).join('\n')

  const userContent: Anthropic.ContentBlockParam[] = []
  // Pass the operator's reference site as visual context — the model
  // sees what "on-brand" looks like for this operator before deciding
  // the page's mood + hero concept.
  if (args.brand_kit?.screenshot_url) {
    userContent.push({ type: 'image', source: { type: 'url', url: args.brand_kit.screenshot_url } })
    userContent.push({ type: 'text', text: 'The image above is the operator\'s existing site — match its visual register without copying its layout.' })
  }
  userContent.push({ type: 'text', text: userText })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{
      name: 'visual_brief',
      description: 'Return the structured visual brief for the landing page.',
      input_schema: TOOL_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'visual_brief' },
    messages: [{ role: 'user', content: userContent }],
  })

  let raw: Record<string, unknown> | null = null
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'visual_brief') {
      raw = block.input as Record<string, unknown>
      break
    }
  }
  if (!raw) {
    throw new Error(`Visual brief returned no output (stop_reason=${response.stop_reason ?? 'unknown'})`)
  }
  return normalise(raw)
}

function normalise(raw: Record<string, unknown>): VisualBrief {
  const illustrationsRaw = Array.isArray(raw.illustrations) ? raw.illustrations : []
  const illustrations: VisualBriefIllustration[] = []
  for (const i of illustrationsRaw) {
    if (!i || typeof i !== 'object') continue
    const o = i as Record<string, unknown>
    const role = typeof o.role === 'string' && (o.role === 'problem' || o.role === 'mechanism' || o.role === 'proof') ? o.role : null
    const concept = typeof o.concept === 'string' ? o.concept.trim() : ''
    const seed = typeof o.prompt_seed === 'string' ? o.prompt_seed.trim() : ''
    if (!role || !concept || !seed) continue
    illustrations.push({ role, concept, prompt_seed: seed })
  }

  const iconsRaw = Array.isArray(raw.icons) ? raw.icons : []
  const icons: VisualBriefIcon[] = []
  for (const i of iconsRaw) {
    if (!i || typeof i !== 'object') continue
    const o = i as Record<string, unknown>
    const role = typeof o.role === 'string' ? o.role.trim().slice(0, 40) : ''
    const name = pickAllowedIcon(o.name)
    const label = typeof o.label === 'string' ? o.label.trim().slice(0, 60) : ''
    if (!role || !name || !label) continue
    icons.push({
      role, name, label,
      rationale: typeof o.rationale === 'string' ? o.rationale.slice(0, 140) : undefined,
    })
  }

  return {
    mood: typeof raw.mood === 'string' ? raw.mood.trim() : '',
    hero_concept: typeof raw.hero_concept === 'string' ? raw.hero_concept.trim() : '',
    hero_prompt_seed: typeof raw.hero_prompt_seed === 'string' ? raw.hero_prompt_seed.trim() : '',
    illustrations,
    icons,
  }
}
