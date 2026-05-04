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
  headline: string
  subheadline?: string
  // VSL: video; lead-gen: image; either: skip
  media?:
    | { kind: 'video'; provider: 'wistia' | 'vimeo' | 'youtube' | 'mux'; embed_url: string; poster_url?: string; autoplay?: boolean }
    | { kind: 'image'; url: string; alt: string }
    | { kind: 'none' }
  cta_label?: string
  cta_target?: 'form' | 'video' | string
  trust_badges?: string[]
}

export interface ProblemSection {
  type: 'problem'
  headline: string
  body: string
  bullets?: string[]
}

export interface MechanismSection {
  type: 'mechanism'
  headline: string
  body: string
  steps?: { label: string; description: string }[]
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
  items: { label: string; description?: string; value?: string }[]
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

export interface PageSpec {
  version: 1
  style: PageStyle
  sections: PageSection[]
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
