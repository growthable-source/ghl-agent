/**
 * Vision-based brand analysis.
 *
 * Takes a rendered-page screenshot and asks Claude Sonnet 4.6 to
 * extract the brand identity in structured JSON. The model "looks
 * at" the page the way a designer would: dominant colors with
 * usage, typography style, photography style, layout vibe, voice
 * tone. Far more useful than regex over HTML — Tailwind grays vs
 * actual brand colors are easy to confuse via CSS, easy to
 * distinguish visually.
 *
 * The output drives:
 *   - The brand color picker (suggested primary + accents)
 *   - The Claude page-generator's voice prompt
 *   - The Gemini image prompts (style + photography direction)
 *   - The renderer's font_family choice (serif vs sans)
 *
 * Cost: ~$0.025 per call (Sonnet 4.6, ~1 image, ~2k output tokens).
 */

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()
const MODEL = 'claude-sonnet-4-6'

export type TypographyStyle = 'serif' | 'sans' | 'display' | 'mixed' | 'unknown'
export type PhotographyStyle =
  | 'illustrated' | 'stock_photo' | 'editorial_photo' | 'product_shot' | 'abstract' | 'none' | 'unknown'
export type VoiceTone =
  | 'friendly' | 'authoritative' | 'playful' | 'luxury' | 'technical' | 'corporate' | 'unknown'

export interface BrandAnalysis {
  primary_color: string // hex
  accent_colors: string[] // hex array, ranked
  typography_style: TypographyStyle
  /** Free-form descriptor like "humanist sans, geometric" or "warm serif, classical". */
  typography_descriptor: string
  photography_style: PhotographyStyle
  /** 2-4 word vibe like "warm minimalist", "bold direct-response", "premium luxury". */
  design_vibe: string
  voice_tone: VoiceTone
  /** 3 short sample sentences in the brand's voice (extracted from the
   *  page, used as Claude voice reference, NEVER copied verbatim). */
  voice_samples: string[]
  /** Visual notes that should carry through to image gen ("lots of
   *  whitespace", "rounded corners", "soft drop shadows", "gradient
   *  backgrounds", "dark mode"). */
  visual_motifs: string[]
  /** Industry / category guess — helps the AI page generator pick
   *  the right tone for the offer. */
  industry_guess: string
}

const SYSTEM_PROMPT = `You are a senior brand strategist analysing a website screenshot to extract the brand's visual + verbal identity. Your output is fed into a landing-page generator that needs to match the brand exactly.

Extract these signals from what you can SEE:

COLORS — give the actual brand color, not the page background. The brand color is usually:
- The primary CTA button background
- The logo color (if visible)
- Repeated accent color across links, headings, icons
- NOT pure grey, NOT pure white, NOT pure black
Return as 6-digit hex strings (#RRGGBB). Be confident — pick the most defensible primary even if you only see one button.

TYPOGRAPHY — what category of typeface does the page use?
- "serif" — has feet (Fraunces, Playfair, Recoleta, Times)
- "sans" — clean sans (Inter, Helvetica, SF Pro, Geist)
- "display" — distinctive display face (Cal Sans, Bricolage, custom)
- "mixed" — serif headings + sans body, or vice versa
Plus a one-line descriptor capturing the FEEL: "humanist sans, friendly", "geometric sans, technical", "warm classical serif", "bold display, hand-drawn".

PHOTOGRAPHY — what kind of imagery does the page rely on?
- "illustrated" — custom illustrations, line drawings, isometric scenes
- "stock_photo" — generic Unsplash-style shots, multi-ethnic team meetings, abstract office vibes
- "editorial_photo" — bespoke photography, real people, real product
- "product_shot" — clean product imagery, e-commerce style
- "abstract" — gradients, 3D shapes, geometric patterns
- "none" — text-only, no imagery
This MATTERS — it tells our image generator what KIND of image to make so we don't put a stock photo on a page that uses illustrations.

DESIGN VIBE — 2-4 words capturing the overall feel: "warm minimalist", "bold direct-response", "premium luxury", "technical/developer", "playful consumer", "editorial magazine", "corporate enterprise", "dense information dashboard".

VOICE TONE — read the visible copy. Pick the dominant tone:
- "friendly" — warm, conversational, "you/we"
- "authoritative" — declarative, expert
- "playful" — wit, humor
- "luxury" — restrained, aspirational
- "technical" — precise, jargon, dev-focused
- "corporate" — formal, polished, B2B
Plus 3 verbatim sentences from the page that demonstrate the voice. EXTRACT them — don't paraphrase. Each ≤120 chars.

VISUAL MOTIFS — note specific design choices to carry into generated imagery:
- whitespace amount ("very generous", "dense")
- corner radius ("sharp corners", "rounded", "pill-shaped")
- shadows ("flat", "soft drop shadows", "dramatic depth")
- gradients ("flat colour", "subtle gradients", "vibrant gradient meshes")
- dark/light mode
- decorative motifs (organic blobs, geometric shapes, patterns)

INDUSTRY GUESS — one short phrase: "B2B SaaS analytics", "DTC skincare", "local chiropractor", "fintech consumer app".

Return everything via the brand_analysis tool. Be specific. If a signal genuinely isn't visible, return the literal string "unknown" — but try hard before giving up.`

const TOOL_SCHEMA = {
  type: 'object' as const,
  required: ['primary_color', 'accent_colors', 'typography_style', 'typography_descriptor', 'photography_style', 'design_vibe', 'voice_tone', 'voice_samples', 'visual_motifs', 'industry_guess'],
  properties: {
    primary_color: { type: 'string', description: '6-digit hex like #1A4FFF.' },
    accent_colors: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    typography_style: { type: 'string', enum: ['serif', 'sans', 'display', 'mixed', 'unknown'] },
    typography_descriptor: { type: 'string', maxLength: 100 },
    photography_style: { type: 'string', enum: ['illustrated', 'stock_photo', 'editorial_photo', 'product_shot', 'abstract', 'none', 'unknown'] },
    design_vibe: { type: 'string', maxLength: 60 },
    voice_tone: { type: 'string', enum: ['friendly', 'authoritative', 'playful', 'luxury', 'technical', 'corporate', 'unknown'] },
    voice_samples: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 5 },
    visual_motifs: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 8 },
    industry_guess: { type: 'string', maxLength: 80 },
  },
}

export async function analyseBrandFromScreenshot(args: {
  screenshotBase64: string
  screenshotMime: 'image/png' | 'image/jpeg'
  /** Visible copy already extracted from the rendered HTML. Helps Claude
   *  ground its voice analysis when the screenshot is text-light. */
  visibleText?: string[]
  /** Extra context about the URL — title, hostname. */
  pageTitle?: string
  hostname?: string
}): Promise<BrandAnalysis> {
  const userTextBits: string[] = []
  if (args.pageTitle) userTextBits.push(`Page title: ${args.pageTitle}`)
  if (args.hostname) userTextBits.push(`Hostname: ${args.hostname}`)
  if (args.visibleText && args.visibleText.length > 0) {
    userTextBits.push(`Visible copy snippets from the rendered DOM (in case the screenshot misses small text):\n${args.visibleText.slice(0, 8).map((s) => `• ${s}`).join('\n')}`)
  }
  userTextBits.push(`Analyse the screenshot and return brand identity via the brand_analysis tool.`)

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{
      name: 'brand_analysis',
      description: 'Return the typed brand identity extracted from the screenshot.',
      input_schema: TOOL_SCHEMA,
    }],
    tool_choice: { type: 'tool', name: 'brand_analysis' },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: args.screenshotMime, data: args.screenshotBase64 } },
        { type: 'text', text: userTextBits.join('\n\n') },
      ],
    }],
  })

  let raw: Record<string, unknown> | null = null
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'brand_analysis') {
      raw = block.input as Record<string, unknown>
      break
    }
  }
  if (!raw) {
    throw new Error(`Vision model returned no analysis (stop_reason=${response.stop_reason ?? 'unknown'})`)
  }
  return normalise(raw)
}

function normalise(raw: Record<string, unknown>): BrandAnalysis {
  return {
    primary_color: hexOrFallback(raw.primary_color, '#0A84FF'),
    accent_colors: Array.isArray(raw.accent_colors)
      ? (raw.accent_colors as unknown[]).map((c) => hexOrFallback(c, '')).filter((c) => !!c).slice(0, 5)
      : [],
    typography_style: enumOr(raw.typography_style, ['serif', 'sans', 'display', 'mixed', 'unknown'], 'unknown'),
    typography_descriptor: typeof raw.typography_descriptor === 'string' ? raw.typography_descriptor : '',
    photography_style: enumOr(raw.photography_style, ['illustrated', 'stock_photo', 'editorial_photo', 'product_shot', 'abstract', 'none', 'unknown'], 'unknown'),
    design_vibe: typeof raw.design_vibe === 'string' ? raw.design_vibe : '',
    voice_tone: enumOr(raw.voice_tone, ['friendly', 'authoritative', 'playful', 'luxury', 'technical', 'corporate', 'unknown'], 'unknown'),
    voice_samples: Array.isArray(raw.voice_samples)
      ? (raw.voice_samples as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 5)
      : [],
    visual_motifs: Array.isArray(raw.visual_motifs)
      ? (raw.visual_motifs as unknown[]).filter((s): s is string => typeof s === 'string' && s.length > 0).slice(0, 8)
      : [],
    industry_guess: typeof raw.industry_guess === 'string' ? raw.industry_guess : '',
  }
}

function hexOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) return v.startsWith('#') ? v : `#${v}`
  return fallback
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  return fallback
}
