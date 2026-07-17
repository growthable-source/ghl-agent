/**
 * Dynamic agent templating for prospect demos — THE core mechanic:
 * the demo agent's prompt/instructions/greeting are templates with
 * per-prospect variables, resolved at provision time so the voice
 * runtime just sees a normal agent.
 *
 * Resolution order per field:
 *   1. per-prospect override (POST body / DemoProspect.templates)
 *   2. vertical preset (VERTICAL_PRESETS)
 *   3. global default
 *
 * Pure functions — no db, no next. Vitest-covered.
 */

export interface DemoTemplateSet {
  prompt: string
  instructions: string | null
  firstMessage: string
}

export type TemplateVars = Record<string, string>

/** `{{ key }}` → vars[key]; unknown keys render as ''. */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? '')
}

/**
 * Base fields + string values from the prospecting tool's metadata
 * (so campaigns can use {{ownerFirstName}}, {{city}}, …). Base fields
 * win on collision — metadata can't rewrite the business name.
 */
export function buildTemplateVars(
  base: { businessName: string; websiteDomain: string; vertical: string | null },
  metadata: Record<string, unknown> | null | undefined,
): TemplateVars {
  const vars: TemplateVars = {}
  for (const [k, v] of Object.entries(metadata ?? {})) {
    if (typeof v === 'string') vars[k] = v
  }
  vars.businessName = base.businessName
  vars.websiteDomain = base.websiteDomain
  vars.vertical = base.vertical ?? ''
  return vars
}

const DEFAULT_PROMPT = `You are the AI receptionist for {{businessName}}. Answer every call the way a warm, capable front-desk person at {{businessName}} would: greet the caller, answer questions about the business, its services, opening hours, location, and pricing, and offer to take a message with the caller's name and number whenever something needs a human.

Ground everything you say about {{businessName}} in the knowledge provided. If you don't know something, say so honestly and offer to take a message — never invent details, prices, or availability. This is a live demonstration, so keep answers snappy and let the caller drive.`

const DEFAULT_FIRST_MESSAGE = `Thanks for calling {{businessName}}! How can I help you today?`

/** Tuned personas per outbound vertical. Partial — unset fields fall back to the defaults above. */
export const VERTICAL_PRESETS: Record<string, Partial<DemoTemplateSet>> = {
  'med-spa': {
    prompt: `You are the AI receptionist for {{businessName}}, a med spa. Answer calls the way a polished, reassuring front-desk coordinator would: help callers with questions about treatments, practitioners, pricing, and availability, and offer to take their name and number to arrange a consultation when they're ready.

Ground everything in the knowledge provided about {{businessName}}. Never give medical advice, never invent treatment outcomes or prices — if you don't know, say so and offer to have the team follow up.`,
  },
  gym: {
    prompt: `You are the AI receptionist for {{businessName}}, a gym. Answer calls with friendly energy: help callers with membership options, class schedules, opening hours, and trial passes, and offer to take their name and number so the team can get them started.

Ground everything in the knowledge provided about {{businessName}}. If you don't know a price or schedule detail, say so honestly and offer to take a message — never make one up.`,
  },
}

/** Vertical → existing marketing landing page for the "Learn more" CTA. */
export const VERTICAL_LANDING_PATHS: Record<string, string> = {
  'med-spa': '/ai-for-med-spas',
  gym: '/ai-for-gyms',
  'customer-service': '/ai-customer-service',
  sdr: '/ai-sdr',
  receptionist: '/ai-receptionist',
}

export function landingPathForVertical(vertical: string | null | undefined): string {
  return (vertical && VERTICAL_LANDING_PATHS[vertical]) || '/ai-receptionist'
}

/** Resolve override → preset → default per field, then render vars. */
export function resolveTemplates(input: {
  vertical: string | null | undefined
  overrides: Partial<DemoTemplateSet> | null | undefined
  vars: TemplateVars
}): DemoTemplateSet {
  const preset = (input.vertical && VERTICAL_PRESETS[input.vertical]) || {}
  const o = input.overrides ?? {}
  const promptTpl = o.prompt ?? preset.prompt ?? DEFAULT_PROMPT
  const instructionsTpl = o.instructions ?? preset.instructions ?? null
  const firstMessageTpl = o.firstMessage ?? preset.firstMessage ?? DEFAULT_FIRST_MESSAGE
  return {
    prompt: renderTemplate(promptTpl, input.vars),
    instructions: instructionsTpl ? renderTemplate(instructionsTpl, input.vars) : null,
    firstMessage: renderTemplate(firstMessageTpl, input.vars),
  }
}
