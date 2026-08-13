/**
 * Whitelabel brand registry for the personalized demo landers (/try/[slug]).
 *
 * WHY THIS EXISTS
 * The /try lander was built as a single Xovera-branded page. Selling the
 * same mechanic through a partner (ASC Warranty → automotive dealerships)
 * needs the identical funnel — register → lazily provision → voice call →
 * checkout — wearing a different company's identity. Forking the route
 * would duplicate ~2.3k lines of page + purchase modal and guarantee that
 * every future fix has to land twice, so instead the ONE route renders
 * brand-aware and every brand-specific string/asset/colour lives here.
 *
 * HOW A PROSPECT GETS A BRAND
 * `DemoProspect.metadata.brand` — a plain string set by the prospecting
 * tool at registration (`POST /api/v1/demo-prospects`). metadata is
 * already free-form Json, so this needs NO migration and no hand-run SQL.
 * Unknown/absent → `xovera`, i.e. every row registered before this
 * existed keeps rendering exactly as it did.
 *
 * PURITY: data only — no JSX, no `next/*`, no db. page.tsx (server) and
 * the section components (client) both import it. Icons are string keys
 * resolved by Features.tsx so this file stays serializable across the
 * server→client boundary.
 */

/** Icon keys resolved to components in app/try/[slug]/sections/Features.tsx. */
export type BrandFeatureIcon = 'bolt' | 'brain' | 'calendar' | 'transfer' | 'clipboard' | 'globe'

export interface BrandFeature {
  icon: BrandFeatureIcon
  title: string
  body: string
}

export interface BrandStat {
  value: string
  label: string
}

export interface BrandTestimonial {
  quote: string
  name: string
  role: string
  /** Optional. When absent the section renders initials — we do NOT put a
   *  stock photo next to a real person's name. */
  avatar?: string
}

/** Hero social-proof strip. `avatars` may be empty — a brand that has no
 *  portrait rights shows the line without faces rather than borrowing
 *  another brand's stock customers. */
export interface BrandHeroProof {
  avatars: string[]
  leadIn: string
  text: string
}

export interface BrandStep {
  n: string
  title: string
  body: string
}

/** Where a rate-limited / stuck buyer is told to go. Rendered into
 *  customer-facing copy, so every brand needs a real, reachable channel. */
export interface BrandSupport {
  /** Human-readable, e.g. "email support@x.io" / "call ASC Dealer Services on (800) 442-7116". */
  contactSentence: string
  email: string | null
}

export interface DemoBrand {
  key: string
  /** Display name used in copy. */
  name: string
  /** Nav/footer logo click target. */
  homeHref: string
  logo:
    | { kind: 'xovera' }
    | { kind: 'image'; src: string; alt: string; aspect: number }
  /** Render heights per slot. Logo lockups differ wildly in how much
   *  height they need to stay legible — a single-line wordmark reads fine
   *  at 24px where a stacked two-line lockup turns to mush — so this is
   *  per-brand rather than a constant in Nav/Footer. */
  logoHeights: { nav: number; footer: number }
  /** Accent overrides applied as CSS variables on the page wrapper. Null
   *  keeps the stock soft-light palette (Xovera). `rgb` is the accent as
   *  bare "r, g, b" so the glow shadows can be built at low alpha. */
  palette: {
    accent: string
    accentHover: string
    /** Lighter stop that gradients ramp toward. */
    accentLight: string
    accentSoft: string
    rgb: string
  } | null
  support: BrandSupport
  /** Absolute origin for magic links in post-purchase email. Null → fall
   *  back to NEXTAUTH_URL/NEXT_PUBLIC_APP_URL as before. */
  baseUrl: string | null
  legal: { privacyHref: string; termsHref: string }
  copy: {
    /** OG/meta description. */
    metaDescription: (businessName: string) => string
    /** Share sheet / clipboard text. */
    shareText: (businessName: string, url: string) => string
    footerAttribution: (businessName: string) => string
    featuresLabel: string
    featuresHeading: string
    featuresSub: string
    processLabel: string
    processHeading: string
    processSub: string
    testimonialsLabel: string
    testimonialsHeading: string
    finalCtaEyebrow: string
    /** Heading is split so the second half can carry the gradient. */
    finalCtaHeadingLead: string
    finalCtaHeadingAccent: string
    finalCtaBody: string
    finalCtaButton: string
    finalCtaLearnMore: string
    finalCtaFootnote: string
    navCta: string
  }
  features: BrandFeature[]
  stats: BrandStat[]
  heroProof: BrandHeroProof
  testimonials: BrandTestimonial[]
  steps: BrandStep[]
}

/* ------------------------------------------------------------------ */
/* Xovera — the original lander, moved here verbatim so the default    */
/* brand renders byte-identically to what shipped before.              */
/* ------------------------------------------------------------------ */

const XOVERA: DemoBrand = {
  key: 'xovera',
  name: 'Xovera',
  homeHref: '/',
  logo: { kind: 'xovera' },
  logoHeights: { nav: 24, footer: 16 },
  palette: null,
  support: { contactSentence: 'email support@xovera.io', email: 'support@xovera.io' },
  baseUrl: null,
  legal: { privacyHref: '/privacy', termsHref: '/terms' },
  copy: {
    metaDescription: b => `Hear the AI receptionist Xovera built for ${b}.`,
    shareText: (b, url) =>
      `Listen to this — an AI receptionist trained on ${b}'s website. It answers like our front desk: ${url}`,
    footerAttribution: b => `Not affiliated with or endorsed by ${b}.`,
    featuresLabel: 'Why Xovera',
    featuresHeading: 'Not a bot. A brilliant receptionist.',
    featuresSub: 'Trained on your business. Sounds human. Works like a machine.',
    processLabel: 'The process',
    processHeading: 'Live in under 2 minutes.',
    processSub: 'No developers. No long contracts. Just a smarter phone.',
    testimonialsLabel: 'Real businesses. Real results.',
    // "\n" renders as a line break (whitespace-pre-line) — preserves the
    // original two-line heading without putting JSX in this data module.
    testimonialsHeading: 'They stopped missing calls.\nYou should too.',
    finalCtaEyebrow: 'Never miss another call',
    finalCtaHeadingLead: 'Your AI receptionist is ',
    finalCtaHeadingAccent: 'ready right now.',
    finalCtaBody:
      'No developers. No long setup. Paste your URL and your phone is covered — nights, weekends, every day.',
    finalCtaButton: '📞 Get My AI Receptionist →',
    finalCtaLearnMore: 'Watch a 2-min explainer',
    finalCtaFootnote: '14-day money-back guarantee · Cancel anytime',
    navCta: 'Get this for my business →',
  },
  features: [
    { icon: 'bolt', title: 'Answers in < 1 second', body: 'No hold music. No voicemail. Every call is picked up instantly, no matter the time of day.' },
    { icon: 'brain', title: 'Knows your business', body: 'Paste your URL and it learns your hours, services, prices, and FAQs in under a minute.' },
    { icon: 'calendar', title: 'Books appointments', body: 'Checks availability and locks in bookings live — synced to your calendar, no follow-up needed.' },
    { icon: 'transfer', title: 'Warm transfers', body: 'When a call needs a human, it hands off seamlessly — briefing your team on what was discussed.' },
    { icon: 'clipboard', title: 'Full call summaries', body: 'Every call transcribed and summarised in your dashboard. Know what callers asked — instantly.' },
    { icon: 'globe', title: 'Multilingual', body: "Speaks 30+ languages. Auto-detects the caller's language and responds naturally — no setup." },
  ],
  stats: [
    { value: '< 1s', label: 'Answer time, guaranteed' },
    { value: '24/7', label: '365 days, no exceptions' },
    { value: '100%', label: 'Call answer rate' },
    { value: '2.4k+', label: 'Businesses already live' },
  ],
  heroProof: {
    avatars: ['/try-demo/avatar-1.jpg', '/try-demo/avatar-3.jpg', '/try-demo/avatar-5.jpg', '/try-demo/avatar-8.jpg'],
    leadIn: '2,400+',
    text: 'businesses never miss a call',
  },
  testimonials: [
    {
      quote: "Feels eerily real. Our customers genuinely thought it was a person. We've not missed a single call in 4 months.",
      name: 'Luke M.',
      role: 'Café Owner, Melbourne',
      avatar: '/try-demo/avatar-luke-m.jpg',
    },
    {
      quote: 'We were losing bookings every weekend. Now the AI handles overflow perfectly. Revenue is up 22%.',
      name: 'Sarah K.',
      role: 'Salon Owner, Sydney',
      avatar: '/try-demo/avatar-5.jpg',
    },
    {
      quote: 'Set up in 90 seconds. It already knew our menu, hours, and could handle reservations. I was floored.',
      name: 'Marco T.',
      role: 'Restaurant Manager, Brisbane',
      avatar: '/try-demo/avatar-marco-t.jpg',
    },
  ],
  steps: [
    { n: '1', title: 'Paste your website', body: 'We scan your site and extract your hours, services, FAQs, pricing, and brand voice automatically.' },
    { n: '2', title: 'AI gets trained', body: 'Your AI receptionist is built and tested — tuned to sound like a natural extension of your team.' },
    { n: '3', title: 'Your phone gets answered', body: 'Forward your number. Every call handled instantly, 24/7. Summaries hit your inbox after each one.' },
  ],
}

/* ------------------------------------------------------------------ */
/* ASC Warranty — automotive dealerships.                              */
/*                                                                     */
/* Auto Services Company, Inc. (ascwarranty.com), vehicle service       */
/* agreements sold through dealers since 1986. Their audience is the    */
/* dealer principal / GM, so the copy is dealership-native (ups, RO,    */
/* F&I, service drive) rather than generic small-business.              */
/*                                                                     */
/* SOCIAL PROOF IS REAL, AND SCOPED HONESTLY. The testimonials below    */
/* are ASC's own published dealer testimonials (ascwarranty.com/        */
/* dealertestimonials.asp) and they are about ASC's service-contract    */
/* and claims service — NOT about this AI product, which is new. The    */
/* section label says exactly that ("What dealers say about ASC") so    */
/* nothing here implies a dealer reviewed the receptionist. Same rule   */
/* for the stats: every figure is a claim ASC already makes publicly.   */
/* Do not swap in Xovera's testimonials or invent dealer quotes.        */
/* ------------------------------------------------------------------ */

const ASC_WARRANTY: DemoBrand = {
  key: 'asc',
  name: 'ASC Warranty',
  homeHref: 'https://www.ascwarranty.com/',
  logo: {
    kind: 'image',
    // 240x117 transparent PNG pulled from ascwarranty.com/graphics/footerlogo.png.
    // The chrome wordmark carries its own dark stroke, so it holds up on
    // the lander's cream background without a plate behind it.
    src: '/brands/asc-warranty-logo.png',
    alt: 'ASC Warranty',
    aspect: 240 / 117,
  },
  // Stacked "ASC" over "WARRANTY" with a fine swoosh — at Xovera's 24px
  // it renders 49x24 and reads as a smudge. 40px in the nav (inside the
  // 64px bar) is the smallest that stays legible.
  logoHeights: { nav: 40, footer: 30 },
  // ASC's brand red, sampled off ascwarranty.com (rgb(221,32,35)). Close
  // enough in hue to the stock accent that the existing gradients, glows
  // and hover tints still read right after the swap.
  palette: {
    accent: '#dd2023',
    accentHover: '#b81a1c',
    accentLight: '#f2564f',
    accentSoft: 'rgba(221, 32, 35, 0.12)',
    rgb: '221, 32, 35',
  },
  support: {
    // ASC's published Dealer Services line. No dealer-facing support inbox
    // is listed publicly, so the phone number is the honest channel here.
    contactSentence: 'call ASC Dealer Services on (800) 442-7116',
    email: null,
  },
  baseUrl: null,
  legal: { privacyHref: '/privacy', termsHref: '/terms' },
  copy: {
    metaDescription: b => `Hear the AI receptionist ASC Warranty built for ${b}.`,
    shareText: (b, url) =>
      `Listen to this — an AI receptionist trained on ${b}'s website. It answers the phone like our front desk: ${url}`,
    footerAttribution: b => `Not affiliated with or endorsed by ${b}.`,
    featuresLabel: 'Why ASC Warranty',
    featuresHeading: 'Not a phone tree. A brilliant receptionist.',
    featuresSub: 'Trained on your dealership. Sounds human. Never misses an up.',
    processLabel: 'The process',
    processHeading: 'Live in under 2 minutes.',
    processSub: 'No developers. No phone-system project. Just a smarter line.',
    testimonialsLabel: 'What dealers say about ASC',
    testimonialsHeading: 'Four decades on the dealer’s side.',
    finalCtaEyebrow: 'Never miss another up',
    finalCtaHeadingLead: 'Your dealership’s AI receptionist is ',
    finalCtaHeadingAccent: 'ready right now.',
    finalCtaBody:
      'No developers. No phone-system project. Paste your URL and every call is covered — nights, weekends, and every hour you’re closed.',
    finalCtaButton: '📞 Get My AI Receptionist →',
    finalCtaLearnMore: 'See how it works',
    finalCtaFootnote: '14-day money-back guarantee · Cancel anytime',
    navCta: 'Get this for my dealership →',
  },
  features: [
    { icon: 'bolt', title: 'Answers every call in < 1 second', body: 'No hold music, no voicemail, no phone tree. Every sales and service call picked up instantly — nights, weekends, and holidays included.' },
    { icon: 'brain', title: 'Knows your store', body: 'Trained on your dealership’s own website: departments, service hours, directions, financing FAQs, and what you stock.' },
    { icon: 'calendar', title: 'Books service appointments', body: 'Checks availability and locks the appointment in live, on the call — instead of promising someone will call back.' },
    { icon: 'transfer', title: 'Routes to the right desk', body: 'Sales, service, parts, or F&I — it transfers the caller and briefs your team on what was already discussed.' },
    { icon: 'clipboard', title: 'Every lead captured', body: 'Name, number, and what they wanted on every single call, transcribed and summarised. Nothing dies in a voicemail box.' },
    { icon: 'globe', title: 'Answers in Spanish', body: 'Auto-detects the caller’s language and switches naturally. 30+ languages, no setup, no extra staff.' },
  ],
  // Every figure below is a claim ASC already publishes on ascwarranty.com.
  stats: [
    { value: 'Since 1986', label: 'Serving dealers and their customers' },
    { value: '40th year', label: 'Helping dealers sell more cars' },
    { value: '24/7', label: 'Roadside assistance on every agreement' },
    { value: 'Nationwide', label: 'Coverage wherever your customers drive' },
  ],
  // No avatars: the stock faces in /try-demo belong to Xovera's lander,
  // and ASC's own dealer testimonials come without portraits. A count of
  // AI-receptionist customers would also be a number ASC hasn't earned
  // yet — so the proof line leans on their real 40-year track record.
  heroProof: {
    avatars: [],
    leadIn: 'Trusted by dealers',
    text: 'nationwide since 1986',
  },
  testimonials: [
    {
      quote:
        'Tri-State Auto Sales has been with ASC Warranty for over 12 years. This is, without a doubt, the best after market service contract company in the business today.',
      name: 'Harvey S.',
      role: 'Tri-State Auto Sales, Inc.',
    },
    {
      quote:
        'The people we deal with in your company, from the receptionist to the claims advisors, are always very helpful and return phone calls on a timely basis.',
      name: 'Paula G.',
      role: "Conrad's Transmission, Inc.",
    },
    {
      quote:
        'For years the service that your company provides for my customers has been great! ASC is the only service agreement company that I offer.',
      name: 'Ron',
      role: 'Old Arcadia Motor Company',
    },
  ],
  steps: [
    { n: '1', title: 'Paste your dealership’s website', body: 'We scan your site for departments, service hours, directions, and the questions customers actually call about.' },
    { n: '2', title: 'Your AI gets trained', body: 'Built and tuned to sound like your front desk — so a caller gets a real answer instead of a menu and a hold queue.' },
    { n: '3', title: 'Your phones get answered', body: 'Forward your main line or just the overflow. Every call handled 24/7, with a summary in your inbox after each one.' },
  ],
}

const BRANDS: Record<string, DemoBrand> = {
  [XOVERA.key]: XOVERA,
  [ASC_WARRANTY.key]: ASC_WARRANTY,
  // Aliases so the prospecting tool can register with the obvious spellings.
  'asc-warranty': ASC_WARRANTY,
  ascwarranty: ASC_WARRANTY,
}

export const DEFAULT_BRAND_KEY = XOVERA.key

/** Resolve a brand by key. Unknown/absent → Xovera (pre-existing behavior). */
export function getBrand(key: string | null | undefined): DemoBrand {
  if (!key) return XOVERA
  return BRANDS[key.trim().toLowerCase()] ?? XOVERA
}

/**
 * Pull the brand key out of a DemoProspect's free-form metadata. Only a
 * string `brand` counts — anything else is treated as unset rather than
 * coerced, so a malformed value degrades to Xovera instead of throwing on
 * a page a prospect is actively looking at.
 */
export function brandKeyFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const raw = (metadata as Record<string, unknown>).brand
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

/**
 * Palette → inline CSS custom properties for the page wrapper. The lander
 * reads `--accent-primary` / `--btn-primary-*` from globals.css; overriding
 * them at the wrapper re-colours buttons, links, icon boxes, gradients and
 * the phone mockup in one place instead of per-component. Empty object for
 * brands with no palette, so Xovera keeps the stock theme untouched.
 */
export function brandCssVars(brand: DemoBrand): Record<string, string> {
  if (!brand.palette) return {}
  const { accent, accentHover, accentLight, accentSoft, rgb } = brand.palette
  return {
    // .section-label and .icon-box read --accent-primary directly; inline
    // `color: var(--accent-primary)` styles across the sections do too.
    '--accent-primary': accent,
    '--accent-primary-bg': accentSoft,
    // .btn-primary paints --gradient-primary (NOT --btn-primary-bg, which
    // the dashboard chrome uses) — miss this and every CTA stays orange.
    '--gradient-primary': `linear-gradient(135deg, ${accent}, ${accentLight})`,
    '--gradient-hero': `linear-gradient(135deg, ${accent} 0%, ${accentHover} 50%, ${accentLight} 100%)`,
    // .text-gradient / .stat-value, tokenized in globals.css for this.
    '--gradient-text': `linear-gradient(135deg, ${accent} 0%, ${accentHover} 45%, ${accentLight} 100%)`,
    '--shadow-primary': `0 10px 40px -10px rgba(${rgb}, 0.25)`,
    '--shadow-primary-hover': `0 14px 50px -10px rgba(${rgb}, 0.4)`,
    '--btn-primary-bg': accent,
    '--btn-primary-hover': accentHover,
    '--logo-bg': accent,
  }
}
