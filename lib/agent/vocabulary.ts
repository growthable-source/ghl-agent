/**
 * Agent vocabulary rules — "never say X, say Y instead."
 *
 * Two layers, because prompt-only bans demonstrably fail: a whitelabel
 * operator's agent kept saying "HighLevel" verbatim out of retrieved
 * knowledge passages despite the persona's never-say line.
 *
 *  1. Prompt layer — buildVocabularyBlock() emits a strict section
 *     with auto-generated ❌/✅ examples, explicitly overriding
 *     knowledge passages ("rewrite the passage's wording").
 *  2. Output layer — applyVocabularyRules() deterministically
 *     find-and-replaces banned terms in the final reply text, so a
 *     rule WITH a replacement can never leak no matter what the model
 *     produced. Rules without a replacement stay prompt-only (there's
 *     no safe way to auto-delete a phrase from a sentence).
 *
 * Stored on Agent.vocabularyRules as Array<{never, sayInstead?}>.
 * The legacy Agent.neverSayList (plain string[]) merges in as
 * replacement-less rules so older agents keep their bans.
 */

export interface VocabularyRule {
  /** Term/phrase that must never appear in replies. */
  never: string
  /** Replacement. Empty/null = ban only (prompt-level, not enforced). */
  sayInstead?: string | null
}

const MAX_RULES = 100
const MAX_TERM_LEN = 120

/**
 * Validate + normalise raw JSON (from DB or PATCH body) into rules.
 * Merges optional legacy neverSayList entries (deduped, rules-first so
 * an upgraded rule with a replacement wins over its legacy plain ban).
 */
export function parseVocabularyRules(raw: unknown, legacyNeverSay?: string[] | null): VocabularyRule[] {
  const out: VocabularyRule[] = []
  const seen = new Set<string>()
  const push = (never: unknown, sayInstead: unknown) => {
    if (typeof never !== 'string') return
    const term = never.trim().slice(0, MAX_TERM_LEN)
    if (!term) return
    const key = term.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    const replacement = typeof sayInstead === 'string' && sayInstead.trim() ? sayInstead.trim().slice(0, MAX_TERM_LEN) : null
    out.push({ never: term, sayInstead: replacement })
  }
  if (Array.isArray(raw)) {
    for (const r of raw.slice(0, MAX_RULES)) {
      if (r && typeof r === 'object') push((r as any).never, (r as any).sayInstead)
    }
  }
  if (Array.isArray(legacyNeverSay)) {
    for (const term of legacyNeverSay.slice(0, MAX_RULES)) push(term, null)
  }
  return out.slice(0, MAX_RULES)
}

/**
 * Strict system-prompt section. Empty string when no rules.
 */
export function buildVocabularyBlock(rules: VocabularyRule[]): string {
  if (rules.length === 0) return ''
  const lines = rules.map(r => {
    if (r.sayInstead) {
      return `- NEVER say "${r.never}" — say "${r.sayInstead}" instead.
  ❌ "You can do this in ${r.never}." → ✅ "You can do this in ${r.sayInstead}."`
    }
    return `- NEVER say "${r.never}" — rephrase to avoid it entirely.`
  })
  return `

## VOCABULARY — ABSOLUTE RULES
These override EVERYTHING else, including your knowledge passages. When a
passage uses a banned term verbatim, rewrite its wording — never quote the
banned term, never put it in examples, lists, or quick replies.

${lines.join('\n')}`
}

/**
 * Deterministic enforcement: replace banned terms that have a
 * replacement, case-insensitively, with word boundaries where the term
 * starts/ends with a word character (so "HighLevel" doesn't fire
 * inside "HighLevelers"... it can't — but "CRM" won't fire inside
 * "CRMs" boundary-wise either; multi-word phrases work too).
 * Replacement-only rules pass through untouched.
 */
export function applyVocabularyRules(text: string, rules: VocabularyRule[]): string {
  if (!text || rules.length === 0) return text
  let out = text
  for (const r of rules) {
    if (!r.sayInstead) continue
    const escaped = r.never.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const prefix = /^\w/.test(r.never) ? '\\b' : ''
    const suffix = /\w$/.test(r.never) ? '\\b' : ''
    try {
      out = out.replace(new RegExp(`${prefix}${escaped}${suffix}`, 'gi'), r.sayInstead)
    } catch {
      // A pathological term that still breaks RegExp shouldn't kill the
      // reply path — skip the rule.
    }
  }
  return out
}
