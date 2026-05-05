/**
 * VSL page generator.
 *
 * Takes the 6-question CampaignIntake from the funnel wizard and returns
 * a structured PageSpec ready to render via <SectionRenderer/>.
 *
 * Uses Anthropic Claude (claude-opus-4-7) with adaptive thinking, prompt
 * caching on the system prompt, and tool calling for typed JSON output.
 * Ported from the lead-hacker-daily voxility-integration reference
 * (supabase/functions/ai-vsl-generate) — same prompt, same tool schema,
 * same output shape.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { PageSection, PageSpec } from '@/lib/page-spec'

const client = new Anthropic()
const MODEL = 'claude-opus-4-7'

export interface CampaignIntake {
  business_name: string
  offer: string
  dream_outcome: string
  false_belief: string
  mechanism: string
  proof: string
  price?: string
  audience?: string
  industry?: string
  brand_voice?: 'friendly' | 'authoritative' | 'playful' | 'luxury'
}

export type PageTemplate = 'vsl' | 'lead_gen' | 'webinar_optin' | 'application' | 'book_call'

export interface GeneratedPage {
  title: string
  meta_description: string
  spec: PageSpec
}

const SYSTEM_PROMPT = `You are a senior direct-response copywriter who has written VSLs that have generated $100M+ across health, wealth, education, and B2B services.

You build pages that CONVERT. You know the structure cold:

  1. HERO — Hook with the dream outcome, in a specific timeframe, with reduced effort. Subhead amplifies. Optional video for VSL pages.
  2. PROBLEM — Agitate the pain. Name what they've tried that didn't work. Surface the specific frustrations.
  3. MECHANISM — Reveal the new opportunity / your unique angle. This is what makes the offer different from everything else they've tried. Often a 3-step framework.
  4. PROOF — Testimonials with names + roles, hard stats with units, brand logos. Concrete > vague.
  5. OFFER — Stack of deliverables with named values. "Here's exactly what you get."
  6. GUARANTEE — Reverse the risk. Money-back, results-based, or pay-only-if-it-works language.
  7. URGENCY — Real reason for urgency (cohort closing, limited capacity, price increase). Avoid fake countdowns.
  8. FAQ — 4–7 questions handling the top objections. Always include "How is this different from...?"
  9. CTA — Final restatement of the offer with a clear button.
  10. FOOTER — Business name, address (if shared), legal links, disclaimer.

Rules:
- The HERO headline is the single most important sentence on the page. Specific outcome > vague benefit.
  Bad: "Transform your business"
  Good: "How Brisbane chiros add 12 new patients/month without spending a dollar on ads"
- Avoid AI-tells: "unlock," "supercharge," "elevate," "in today's world," generic adjectives, em-dashes everywhere, three-item parallel sentences.
- Headlines: 6–14 words, specific, concrete, ideally with a number.
- Bullets in problem section: punchy, 5–10 words, present tense.
- Testimonials: 1–3 sentences, written like a person actually said it. NEVER invent the author's full name or company — use placeholder names like "Sarah K., chiropractor" rather than fabricating identities.
- Stats: pair a number with a unit and a label. "$2.1M" / "Generated in pipeline".
- Offer items: each has a label, optional description, optional dollar value.
- Guarantee body: 2–3 sentences. State the exact terms.
- FAQ answers: short paragraph, 2–4 sentences each.
- DO NOT include section types beyond: hero, problem, mechanism, proof, offer, guarantee, urgency, faq, cta, form, footer.
- Always include a "form" section as a marker right after the OFFER (the actual form is rendered by the platform — this is just a placement marker with optional headline/body).
- Match brand voice if specified. Default = friendly + authoritative.
- Never invent specific URLs, phone numbers, addresses, or testimonial names with real identifiers. Use placeholders the operator will replace.

Always return your output via the return_page_spec tool — never as plain text.`

const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string', description: 'Page <title>, used for SEO and OG. 50–70 chars ideal.' },
    meta_description: { type: 'string', description: 'Meta description for SEO. 140–160 chars.' },
    sections: {
      type: 'array',
      description: 'Ordered list of page sections.',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'hero', 'problem', 'mechanism', 'proof', 'offer',
              'guarantee', 'urgency', 'faq', 'cta', 'form', 'footer',
            ],
          },
          eyebrow: { type: 'string' },
          headline: { type: 'string' },
          subheadline: { type: 'string' },
          cta_label: { type: 'string' },
          trust_badges: { type: 'array', items: { type: 'string' } },
          body: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          steps: {
            type: 'array',
            description: 'For mechanism: 3-step framework reveal.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label', 'description'],
            },
          },
          stats: {
            type: 'array',
            items: {
              type: 'object',
              properties: { value: { type: 'string' }, label: { type: 'string' } },
              required: ['value', 'label'],
            },
          },
          testimonials: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                quote: { type: 'string' },
                author_name: { type: 'string' },
                author_role: { type: 'string' },
              },
              required: ['quote', 'author_name'],
            },
          },
          description: { type: 'string' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label'],
            },
          },
          total_value: { type: 'string' },
          price: { type: 'string' },
          badge_text: { type: 'string' },
          faqs: {
            type: 'array',
            description: "FAQ items (use 'faqs' here for clarity).",
            items: {
              type: 'object',
              properties: { question: { type: 'string' }, answer: { type: 'string' } },
              required: ['question', 'answer'],
            },
          },
          business_name: { type: 'string' },
          business_address: { type: 'string' },
          business_phone: { type: 'string' },
          business_email: { type: 'string' },
          disclaimer: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['title', 'meta_description', 'sections'],
}

interface RawSection {
  type: string
  [key: string]: unknown
}

function arrayOrUndefined<T>(v: unknown, max: number, mapper: (item: unknown) => T | null): T[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.slice(0, max).map(mapper).filter((x): x is T => x !== null)
  return out.length > 0 ? out : undefined
}

function toStr(v: unknown, max?: number): string {
  const s = String(v ?? '').trim()
  return max ? s.slice(0, max) : s
}

/** Map an AI section payload onto the typed PageSection shape. Drops
 *  fields that don't belong on a given section type and applies length
 *  caps so the renderer never crashes on a runaway field. */
function normalizeSection(raw: RawSection): PageSection | null {
  if (!raw || typeof raw.type !== 'string') return null
  const r = raw as Record<string, unknown>

  switch (r.type) {
    case 'hero':
      return {
        type: 'hero',
        eyebrow: r.eyebrow ? toStr(r.eyebrow, 60) : undefined,
        headline: toStr(r.headline) || 'Get started today',
        subheadline: r.subheadline ? toStr(r.subheadline) : undefined,
        cta_label: toStr(r.cta_label) || 'Get instant access',
        cta_target: 'form',
        trust_badges: arrayOrUndefined(r.trust_badges, 5, (b) => toStr(b, 60) || null),
        media: { kind: 'none' },
      }
    case 'problem':
      return {
        type: 'problem',
        headline: toStr(r.headline),
        body: toStr(r.body),
        bullets: arrayOrUndefined(r.bullets, 8, (b) => toStr(b, 200) || null),
      }
    case 'mechanism':
      return {
        type: 'mechanism',
        headline: toStr(r.headline),
        body: toStr(r.body),
        steps: arrayOrUndefined(r.steps, 5, (st) => {
          if (!st || typeof st !== 'object') return null
          const s = st as Record<string, unknown>
          const label = toStr(s.label, 80)
          const description = toStr(s.description, 240)
          if (!label) return null
          return { label, description }
        }),
      }
    case 'proof':
      return {
        type: 'proof',
        headline: r.headline ? toStr(r.headline) : undefined,
        stats: arrayOrUndefined(r.stats, 4, (s) => {
          if (!s || typeof s !== 'object') return null
          const o = s as Record<string, unknown>
          const value = toStr(o.value)
          const label = toStr(o.label)
          if (!value || !label) return null
          return { value, label }
        }),
        testimonials: arrayOrUndefined(r.testimonials, 6, (t) => {
          if (!t || typeof t !== 'object') return null
          const o = t as Record<string, unknown>
          const quote = toStr(o.quote)
          const author_name = toStr(o.author_name)
          if (!quote || !author_name) return null
          return {
            quote,
            author_name,
            author_role: o.author_role ? toStr(o.author_role) : undefined,
          }
        }),
      }
    case 'offer':
      return {
        type: 'offer',
        headline: toStr(r.headline) || "Here's what you get",
        description: r.description ? toStr(r.description) : undefined,
        items: arrayOrUndefined(r.items, 12, (it) => {
          if (!it || typeof it !== 'object') return null
          const o = it as Record<string, unknown>
          const label = toStr(o.label)
          if (!label) return null
          return {
            label,
            description: o.description ? toStr(o.description) : undefined,
            value: o.value ? toStr(o.value) : undefined,
          }
        }) ?? [],
        total_value: r.total_value ? toStr(r.total_value) : undefined,
        price: r.price ? toStr(r.price) : undefined,
      }
    case 'guarantee':
      return {
        type: 'guarantee',
        headline: toStr(r.headline) || 'Our guarantee',
        body: toStr(r.body),
        badge_text: r.badge_text ? toStr(r.badge_text, 30) : undefined,
      }
    case 'urgency':
      return {
        type: 'urgency',
        headline: toStr(r.headline) || 'Limited availability',
        body: r.body ? toStr(r.body) : undefined,
      }
    case 'faq': {
      const sourceItems = (r.faqs ?? r.items) as unknown
      return {
        type: 'faq',
        headline: r.headline ? toStr(r.headline) : 'Frequently asked questions',
        items: arrayOrUndefined(sourceItems, 10, (f) => {
          if (!f || typeof f !== 'object') return null
          const o = f as Record<string, unknown>
          const question = toStr(o.question)
          const answer = toStr(o.answer)
          if (!question || !answer) return null
          return { question, answer }
        }) ?? [],
      }
    }
    case 'cta':
      return {
        type: 'cta',
        headline: toStr(r.headline) || 'Ready to get started?',
        body: r.body ? toStr(r.body) : undefined,
        cta_label: toStr(r.cta_label) || 'Get instant access',
        cta_target: 'form',
      }
    case 'form':
      return {
        type: 'form',
        headline: r.headline ? toStr(r.headline) : undefined,
        body: r.body ? toStr(r.body) : undefined,
      }
    case 'footer':
      return {
        type: 'footer',
        business_name: toStr(r.business_name),
        business_address: r.business_address ? toStr(r.business_address) : undefined,
        business_phone: r.business_phone ? toStr(r.business_phone) : undefined,
        business_email: r.business_email ? toStr(r.business_email) : undefined,
        disclaimer: r.disclaimer ? toStr(r.disclaimer) : undefined,
        legal_links: [
          { label: 'Privacy', url: '/privacy' },
          { label: 'Terms', url: '/terms' },
        ],
      }
    default:
      return null
  }
}

function userPrompt(intake: CampaignIntake, template: PageTemplate): string {
  return `Build a ${template} landing page for this business.

Business: ${intake.business_name}
${intake.industry ? `Industry: ${intake.industry}` : ''}
${intake.audience ? `Target audience: ${intake.audience}` : ''}
Offer: ${intake.offer}
Dream outcome: ${intake.dream_outcome}
False belief blocking the prospect: ${intake.false_belief}
Mechanism (what makes this different): ${intake.mechanism}
Proof / track record: ${intake.proof}
${intake.price ? `Price: ${intake.price}` : 'Price: free'}
${intake.brand_voice ? `Brand voice: ${intake.brand_voice}` : ''}

Return the complete page via the return_page_spec tool. Include hero, problem, mechanism, proof, offer, form (marker), guarantee, urgency, faq, cta, footer in that order. Make every line concrete and specific to this business.`
}

interface AiPageRaw {
  title?: string
  meta_description?: string
  sections?: RawSection[]
}

/** Generate a complete page spec for a campaign intake.
 *
 *  Throws Anthropic.RateLimitError / Anthropic.APIError on transient
 *  failures — the caller should map those to 429/503 responses.
 *
 *  Returns a fully-typed PageSpec. The `sections` array is post-
 *  processed: hero, form, and footer are always present, even if the
 *  model omitted them. */
export async function generateVslPage(input: {
  intake: CampaignIntake
  template?: PageTemplate
  primary_color?: string
}): Promise<GeneratedPage> {
  if (!input.intake?.business_name || !input.intake?.offer || !input.intake?.dream_outcome) {
    throw new Error('intake.business_name, offer, and dream_outcome are required')
  }

  const template = input.template ?? 'vsl'
  const primaryColor = input.primary_color ?? '#0A84FF'

  // NOTE: `thinking` is not allowed when tool_choice forces a specific
  // tool — Anthropic returns 400. For structured-output generation that's
  // fine: forcing the tool call is what we need, and the model doesn't
  // benefit from extended thinking to fill a typed schema.
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [
      {
        name: 'return_page_spec',
        description:
          'Return the complete VSL/landing page spec as title, meta_description, and an ordered array of typed sections.',
        input_schema: TOOL_SCHEMA,
      },
    ],
    tool_choice: { type: 'tool', name: 'return_page_spec' },
    messages: [{ role: 'user', content: userPrompt(input.intake, template) }],
  })

  let parsed: AiPageRaw | null = null
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'return_page_spec') {
      parsed = block.input as AiPageRaw
      break
    }
  }
  if (!parsed) {
    throw new Error(`Model did not return a page spec. stop_reason=${response.stop_reason ?? 'unknown'}`)
  }

  const rawSections = Array.isArray(parsed.sections) ? parsed.sections : []
  const sections: PageSection[] = []
  for (const r of rawSections) {
    const normalized = normalizeSection(r)
    if (normalized) sections.push(normalized)
  }

  // Backstop missing structural sections so the renderer never crashes.
  const haveTypes = new Set(sections.map((s) => s.type))
  if (!haveTypes.has('hero')) {
    sections.unshift({
      type: 'hero',
      headline: input.intake.dream_outcome,
      subheadline: input.intake.offer,
      cta_label: 'Get instant access',
      cta_target: 'form',
      media: { kind: 'none' },
    })
  }
  if (!haveTypes.has('form')) {
    const footerIdx = sections.findIndex((s) => s.type === 'footer')
    const insertAt = footerIdx >= 0 ? footerIdx : sections.length
    sections.splice(insertAt, 0, { type: 'form', headline: 'Get started' })
  }
  if (!haveTypes.has('footer')) {
    sections.push({
      type: 'footer',
      business_name: input.intake.business_name,
      legal_links: [
        { label: 'Privacy', url: '/privacy' },
        { label: 'Terms', url: '/terms' },
      ],
      disclaimer: `© ${new Date().getFullYear()} ${input.intake.business_name}. All rights reserved.`,
    })
  }

  return {
    title: parsed.title ?? `${input.intake.business_name} — ${input.intake.dream_outcome}`,
    meta_description: parsed.meta_description ?? input.intake.offer.slice(0, 160),
    spec: {
      version: 1,
      style: {
        primary_color: primaryColor,
        background: 'white',
        font_family: 'system',
        max_width: 'default',
      },
      sections,
    },
  }
}
