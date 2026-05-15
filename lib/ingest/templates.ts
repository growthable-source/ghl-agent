/**
 * Domain templates — pre-baked starting points for new knowledge domains.
 *
 * When an operator creates a domain they pick a template and we seed
 * sensible taxonomy keys + intent tags so the classifier has something
 * to bin chunks into on day one. Operators can edit / add later — the
 * template just removes the blank-page problem.
 *
 * Adding a template: append an entry below. Keep keys lowercase and
 * stable (they're stored on every chunk) — labels can change freely.
 */

export interface DomainTemplate {
  id: string
  name: string
  description: string
  icon: string
  /** Default intent tags — written to KnowledgeDomain.defaultIntentTags
   *  and offered to the LLM classifier alongside the taxonomy. */
  intentTags: string[]
  /** Seed taxonomy rows. The operator can rename, delete, or add more
   *  after the domain is created. */
  taxonomy: Array<{ key: string; label: string; aliases?: string[]; parentKey?: string }>
}

export const DOMAIN_TEMPLATES: DomainTemplate[] = [
  {
    id: 'product_support',
    name: 'Product Support',
    description: 'Help-centre, FAQs, troubleshooting guides. Best for SaaS products and customer success teams.',
    icon: '🛟',
    intentTags: ['how_to', 'troubleshooting', 'pricing', 'account', 'integration'],
    taxonomy: [
      { key: 'getting_started', label: 'Getting Started' },
      { key: 'billing',         label: 'Billing & Plans', aliases: ['subscription', 'invoice'] },
      { key: 'account',         label: 'Account Settings', aliases: ['profile', 'login'] },
      { key: 'integrations',    label: 'Integrations',     aliases: ['api', 'webhook'] },
      { key: 'troubleshooting', label: 'Troubleshooting',  aliases: ['error', 'bug', 'fix'] },
      { key: 'features',        label: 'Features',         aliases: ['functionality'] },
    ],
  },
  {
    id: 'legal',
    name: 'Legal Documentation',
    description: 'Contracts, compliance, IP, employment law. For legal teams and law-adjacent products.',
    icon: '⚖️',
    intentTags: ['definition', 'procedure', 'requirement', 'case_law', 'jurisdiction'],
    taxonomy: [
      { key: 'contracts',  label: 'Contracts',         aliases: ['agreement', 'tos'] },
      { key: 'compliance', label: 'Compliance',        aliases: ['regulation', 'gdpr', 'ccpa'] },
      { key: 'ip',         label: 'Intellectual Property', aliases: ['patent', 'trademark', 'copyright'] },
      { key: 'employment', label: 'Employment Law',    aliases: ['hr', 'labor'] },
      { key: 'privacy',    label: 'Privacy & Data',    aliases: ['data_protection'] },
    ],
  },
  {
    id: 'coaching',
    name: 'Coaching & Training',
    description: 'Methodologies, frameworks, exercises, case studies. For coaches and educational content.',
    icon: '🎓',
    intentTags: ['concept', 'exercise', 'principle', 'example', 'reflection'],
    taxonomy: [
      { key: 'mindset',     label: 'Mindset & Beliefs' },
      { key: 'methodology', label: 'Methodology',        aliases: ['framework', 'system'] },
      { key: 'case_study',  label: 'Case Studies',       aliases: ['example', 'story'] },
      { key: 'practice',    label: 'Exercises & Practice', aliases: ['drill', 'homework'] },
      { key: 'theory',      label: 'Theory & Background' },
    ],
  },
  {
    id: 'ecommerce',
    name: 'E-commerce',
    description: 'Product catalogue, shipping, returns, order tracking. For retail and Shopify-adjacent brands.',
    icon: '🛒',
    intentTags: ['how_to', 'policy', 'product_info', 'order_status', 'shipping'],
    taxonomy: [
      { key: 'products',  label: 'Product Information', aliases: ['catalogue', 'sku'] },
      { key: 'shipping',  label: 'Shipping & Delivery', aliases: ['fulfilment', 'tracking'] },
      { key: 'returns',   label: 'Returns & Refunds',   aliases: ['exchange', 'rma'] },
      { key: 'payments',  label: 'Payments & Checkout', aliases: ['billing', 'gateway'] },
      { key: 'sizing',    label: 'Sizing & Fit' },
      { key: 'care',      label: 'Care & Maintenance' },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Start with an empty domain and build your own taxonomy from scratch. Pick this if none of the above fit.',
    icon: '✨',
    intentTags: [],
    taxonomy: [],
  },
]

/**
 * Source-type cards for the source picker. Each entry maps to a
 * SourceAdapter (`sourceType`) plus the friendly metadata + form
 * fields the UI shows.
 */
export interface SourceTypeCard {
  sourceType: string
  name: string
  description: string
  icon: string
  /** When `false`, the card renders disabled with a "Coming soon" pill. */
  available: boolean
  /** What field label to show when the operator is filling in the
   *  `urlOrIdentifier` field. */
  identifierLabel: string
  identifierPlaceholder: string
  identifierHint: string
  /** Default crawl_config — applied if the operator doesn't customise. */
  defaultConfig: Record<string, unknown>
}

export const SOURCE_TYPE_CARDS: SourceTypeCard[] = [
  {
    sourceType: 'docs',
    name: 'Help Center / Docs Site',
    description: 'Point at the root URL of your help centre, documentation site, or knowledge base. We discover every page reachable from there (up to 2000) and keep them in sync.',
    icon: '📚',
    available: true,
    identifierLabel: 'Help Center URL',
    identifierPlaceholder: 'https://help.example.com',
    identifierHint: 'Paste the homepage of your docs or help center. We crawl up to 2000 pages — enough for almost any site.',
    defaultConfig: { recrawlIntervalDays: 7, recursive: true, maxPages: 2000 },
  },
  {
    sourceType: 'pdf',
    name: 'PDF Upload',
    description: 'Upload a PDF (training manual, contract, runbook). We extract the text and index every page.',
    icon: '📄',
    available: true,
    identifierLabel: 'Storage path (Vercel Blob)',
    identifierPlaceholder: 'pdfs/onboarding-guide-v3.pdf',
    identifierHint: 'Upload the PDF to Vercel Blob first; paste the storage path here. We\'ll wire up direct upload in a follow-up.',
    defaultConfig: {},
  },
  {
    sourceType: 'youtube',
    name: 'YouTube Channel / Playlist',
    description: 'Index transcripts from a channel or playlist. Great for training content and product videos.',
    icon: '🎥',
    available: false,
    identifierLabel: 'YouTube URL',
    identifierPlaceholder: 'https://youtube.com/@channel',
    identifierHint: '',
    defaultConfig: {},
  },
  {
    sourceType: 'rss',
    name: 'RSS / Blog Feed',
    description: 'Subscribe to a blog or release-notes feed. New posts get ingested on each crawl.',
    icon: '📰',
    available: false,
    identifierLabel: 'Feed URL',
    identifierPlaceholder: 'https://blog.example.com/rss',
    identifierHint: '',
    defaultConfig: {},
  },
  {
    sourceType: 'notion',
    name: 'Notion Workspace',
    description: 'Pull from a Notion database or page tree. Auth via Notion API.',
    icon: '📓',
    available: false,
    identifierLabel: 'Notion page or database ID',
    identifierPlaceholder: '',
    identifierHint: '',
    defaultConfig: {},
  },
]
