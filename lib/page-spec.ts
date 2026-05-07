/**
 * Voxility landing-page spec
 *
 * Structured JSON shape stored in `LandingPage.spec`. The AI generator
 * (lib/vsl-generator.ts, phase 3) outputs this; the renderer
 * (components/vsl/sections.tsx + app/p/[slug]/page.tsx) consumes it.
 *
 * A page is an ordered array of sections. Each section is a discriminated
 * union by `type`. New section types must be added here AND in the
 * renderer's <SectionRenderer/> switch.
 *
 * Ported from the lead-hacker-daily voxility-integration reference branch
 * (src/lib/page-spec.ts) — same shape, no behavior change.
 */

export type CanonicalFormField =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'message'

export interface FormSchema {
  fields: CanonicalFormField[]
  required: CanonicalFormField[]
  cta_label: string
  consent_text?: string
  success_headline?: string
  success_body?: string
}

// ─── Section unions ────────────────────────────────────────────────────

export interface HeroSection {
  type: 'hero'
  eyebrow?: string
  /** Headline. Supports the [accent]…[/accent] markup the renderer
   *  parses into a script-font, brand-coloured span (Manus-style
   *  emotional anchor like "Beauty Brand" set in red script). */
  headline: string
  subheadline?: string
  // VSL: video; lead-gen: image; either: skip
  media?:
    | { kind: 'video'; provider: 'wistia' | 'vimeo' | 'youtube' | 'mux'; embed_url: string; poster_url?: string; autoplay?: boolean }
    | { kind: 'image'; url: string; alt: string }
    | { kind: 'none' }
  cta_label?: string
  cta_target?: 'form' | 'video' | string
  /** Secondary CTA — phone number with icon, alt link, or
   *  "watch video". Renders alongside the primary CTA. */
  secondary_cta?: {
    label: string
    href?: string
    /** Visual style: 'phone' adds a phone icon + dark fill,
     *  'ghost' is a transparent border button. */
    kind?: 'phone' | 'ghost'
  }
  trust_badges?: string[]
  /** Layout hint — drives which Hero variant the renderer picks.
   *  When omitted, auto-resolved by the page renderer based on
   *  template + presence of media + form. */
  layout?: 'gradient' | 'split-image' | 'image-bg' | 'form-in-hero'
}

/** Top navigation header (logo + nav links + primary CTA). AI auto-
 *  emits this on lead-gen-style templates so pages don't look like
 *  raw scrolljacks without a brand surround. */
export interface HeaderSection {
  type: 'header'
  /** Optional override — defaults to the brand kit's logo URL.
   *  When neither is set, falls back to business name as text. */
  logo_url?: string
  business_name?: string
  /** 3-5 nav links. Anchor links to on-page sections (#proof,
   *  #faq, #contact) or external. */
  nav_links?: { label: string; href: string }[]
  /** Header-right CTA — usually mirrors the hero CTA. */
  cta_label?: string
  cta_target?: 'form' | string
}

export interface ProblemSection {
  type: 'problem'
  headline: string
  body: string
  bullets?: string[]
  /** Optional pain-point cards. Each pain has a Lucide icon name from
   *  lib/lucide-allowlist; the renderer draws the icon in brand colour
   *  and uses it as the focal element of the card. When `pains` is
   *  set, `bullets` is ignored. */
  pains?: { icon: string; label: string; description?: string }[]
  /** Replicate-generated illustration URL (Flux 1.1 Pro Ultra) that
   *  visualises the "before" state. Renderer slots it as a side
   *  illustration alongside the pain cards. */
  illustration_url?: string
}

export interface MechanismSection {
  type: 'mechanism'
  headline: string
  body: string
  steps?: {
    label: string
    description: string
    /** Lucide icon name (from lib/lucide-allowlist) representing this
     *  step. Renderer draws it in brand colour as the step's visual. */
    icon?: string
    /** AI-generated icon image URL — legacy, kept for backward compat
     *  with old spec data. Prefer `icon` (Lucide name) for new specs. */
    icon_url?: string
  }[]
  /** Replicate-generated illustration of the mechanism / process —
   *  visual abstraction of how the offer works. */
  illustration_url?: string
}

export interface ProofSection {
  type: 'proof'
  headline?: string
  testimonials?: {
    quote: string
    author_name: string
    author_role?: string
    author_image_url?: string
  }[]
  stats?: { value: string; label: string }[]
  logos?: { url: string; alt: string }[]
}

export interface OfferSection {
  type: 'offer'
  headline: string
  description?: string
  /** Each item gets a Lucide icon (from lib/lucide-allowlist) drawn
   *  in brand colour as its visual. Renderer falls back to a check
   *  mark if `icon` is missing. */
  items: { label: string; description?: string; value?: string; icon?: string }[]
  total_value?: string
  price?: string
}

export interface GuaranteeSection {
  type: 'guarantee'
  headline: string
  body: string
  badge_text?: string
}

export interface UrgencySection {
  type: 'urgency'
  headline: string
  body?: string
  /** Optional ISO 8601 — server renders the static target; client islands
   *  not needed for v1 since the renderer is fully server-side. */
  countdown_to?: string
}

export interface FAQSection {
  type: 'faq'
  headline?: string
  items: { question: string; answer: string }[]
}

export interface CTASection {
  type: 'cta'
  headline: string
  body?: string
  cta_label: string
  cta_target?: 'form' | string
}

export interface FormSection {
  /** Marker section. The renderer places <FormBlock/> here. The actual
   *  fields live on the page row's `formSchema` column. */
  type: 'form'
  headline?: string
  body?: string
}

export interface FooterSection {
  type: 'footer'
  business_name: string
  business_address?: string
  business_phone?: string
  business_email?: string
  legal_links?: { label: string; url: string }[]
  disclaimer?: string
}

export type PageSection =
  | HeaderSection
  | HeroSection
  | ProblemSection
  | MechanismSection
  | ProofSection
  | OfferSection
  | GuaranteeSection
  | UrgencySection
  | FAQSection
  | CTASection
  | FormSection
  | FooterSection

// ─── Top-level page spec ───────────────────────────────────────────────

export interface PageStyle {
  primary_color?: string
  background?: 'white' | 'dark' | 'gradient'
  font_family?: 'system' | 'serif' | 'display'
  max_width?: 'narrow' | 'default' | 'wide'
}

/** AI-generated imagery. Populated by lib/page-assets.ts before the
 *  text spec lands so Claude can compose the page knowing what
 *  visual building blocks are available. Renderer degrades gracefully
 *  when any field is missing. */
export interface PageImages {
  /** Hero feature image. Wide aspect (16:9 or 3:2), photographic. */
  hero_url?: string
  /** Page-level full-bleed background image. Vertical aspect (3:4
   *  or taller) — applied as a fixed background layer behind the
   *  whole page, with a brand-coherent overlay for legibility. Every
   *  page should have one — pages without a background read as
   *  template-y and unfinished. */
  background_url?: string
  /** Wide background image for the offer / CTA strip. */
  offer_bg_url?: string
  /** OG image (1200x630). Used for social link previews. */
  og_url?: string
  /** Section illustrations — keyed by role ("problem", "mechanism",
   *  "proof", "offer"). The spec generator picks which sections use
   *  illustrations vs. icons; these are the URLs it composes from. */
  illustrations?: Record<string, string>
}

export interface PageSpec {
  version: 1
  style: PageStyle
  sections: PageSection[]
  /** AI-generated imagery layered on top of the text spec. Optional. */
  images?: PageImages
}

/** Empty page spec — used as a fallback when LandingPage.spec is unset. */
export const EMPTY_PAGE_SPEC: PageSpec = {
  version: 1,
  style: { primary_color: '#0A84FF', background: 'white', font_family: 'system', max_width: 'default' },
  sections: [],
}

/** Default form schema for VSL/lead-gen. Phone is the load-bearing field
 *  because the agent callback flow is the differentiator. */
export const DEFAULT_FORM_SCHEMA: FormSchema = {
  fields: ['first_name', 'email', 'phone'],
  required: ['email', 'phone'],
  cta_label: 'Get instant access',
  consent_text:
    'By submitting you agree to be contacted by phone, SMS, and email. You can opt out at any time.',
  success_headline: "You're in. Check your phone.",
  success_body:
    "Our team will reach out in the next 60 seconds. Keep your phone close.",
}

/** Type narrowing helper — Prisma stores `spec` as Json so the read-side
 *  needs to validate and fall back. */
export function parsePageSpec(raw: unknown): PageSpec {
  if (!raw || typeof raw !== 'object') return EMPTY_PAGE_SPEC
  const candidate = raw as Partial<PageSpec>
  if (candidate.version !== 1 || !Array.isArray(candidate.sections)) return EMPTY_PAGE_SPEC
  return {
    version: 1,
    style: candidate.style ?? EMPTY_PAGE_SPEC.style,
    sections: candidate.sections,
    images: candidate.images,
  }
}

export function parseFormSchema(raw: unknown): FormSchema {
  if (!raw || typeof raw !== 'object') return DEFAULT_FORM_SCHEMA
  const candidate = raw as Partial<FormSchema>
  if (!Array.isArray(candidate.fields) || candidate.fields.length === 0) {
    return DEFAULT_FORM_SCHEMA
  }
  return {
    fields: candidate.fields as CanonicalFormField[],
    required: (candidate.required ?? []) as CanonicalFormField[],
    cta_label: candidate.cta_label ?? DEFAULT_FORM_SCHEMA.cta_label,
    consent_text: candidate.consent_text ?? DEFAULT_FORM_SCHEMA.consent_text,
    success_headline: candidate.success_headline ?? DEFAULT_FORM_SCHEMA.success_headline,
    success_body: candidate.success_body ?? DEFAULT_FORM_SCHEMA.success_body,
  }
}
