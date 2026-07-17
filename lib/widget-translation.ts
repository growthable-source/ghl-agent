/**
 * Detect-and-translate via Claude Haiku.
 *
 * Strategy:
 *   - One Haiku call per message detects the language AND returns an
 *     English translation if it's not already English.
 *   - English messages skip the translation field entirely.
 *   - Runs async (via after()) on every widget message persistence, so
 *     the chat path doesn't wait. The operator inbox picks up the
 *     translation via a `translation_update` SSE event.
 *
 * Cost: ~$0.0001 per chat message. Trivial at any realistic volume.
 *
 * Why this exists: the agent now replies in the visitor's language,
 * but the human operator might only speak English. Without a
 * translation under each non-English message they can't follow what
 * their AI is saying.
 */

import { db } from './db'
import { broadcast } from './widget-sse'
import { createMessage } from './llm'

const MODEL = 'claude-haiku'

// ISO 639-1 codes we accept back from the model. We constrain the
// output to a known set so a creative Haiku can't slip "Klingon" or
// "tlh" into the language column and pollute analytics.
const VALID_LANGS = new Set([
  'en','es','fr','de','it','pt','nl','sv','no','da','fi','pl','ru','uk','tr',
  'ar','he','fa','hi','bn','ja','ko','zh','vi','th','id','ms','tl','el','cs',
  'hu','ro','bg','hr','sr','sk','sl','et','lv','lt',
])

export interface TranslationResult {
  language: string         // ISO 639-1
  translationEn: string | null  // null if language === 'en'
}

/**
 * Detect the language of a message and, if non-English, return the
 * English translation. Returns null on failure — the caller treats
 * the message as if no detection happened (no translation stored).
 *
 * For the typical case (English) this still costs a Haiku call.
 * That's fine — ~$0.0001/message.
 */
export async function detectAndTranslate(content: string): Promise<TranslationResult | null> {
  const text = (content || '').trim()
  if (!text || text.length < 2) return null

  // Heuristic shortcut: if the message is short AND ASCII-only AND
  // contains common English stopwords, skip the Haiku call and tag
  // as English. Cuts ~70% of calls in English-dominant workspaces.
  if (text.length < 200 && /^[\x00-\x7F\s]+$/.test(text)) {
    const lower = ` ${text.toLowerCase()} `
    if (/ (the|and|is|of|to|i|you|a|in|it|for|with|are|on|that|this|have|was) /.test(lower)) {
      return { language: 'en', translationEn: null }
    }
  }

  try {
    const completion = await createMessage(MODEL, {
      max_tokens: 600,
      system:
        'Detect the language of the user-supplied text and translate to English if it is not English.\n' +
        'Output STRICT JSON:\n' +
        '  { "language": "<iso-639-1>", "translationEn": "<english text>" | null }\n' +
        'Rules:\n' +
        '- language MUST be a lowercase ISO 639-1 code (en, es, fr, de, pt, zh, ja, ...)\n' +
        '- translationEn MUST be null when language is "en". Otherwise a faithful English translation.\n' +
        '- Output ONLY the JSON object. No markdown, no preamble, no explanation.',
      messages: [{ role: 'user', content: text }],
    }, { surface: 'translation' })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const raw = (block?.text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
    const parsed = JSON.parse(raw)
    const lang = typeof parsed?.language === 'string' ? parsed.language.toLowerCase().slice(0, 4) : null
    if (!lang || !VALID_LANGS.has(lang)) return null
    if (lang === 'en') return { language: 'en', translationEn: null }
    const translation = typeof parsed?.translationEn === 'string' ? parsed.translationEn.trim() : null
    if (!translation) return { language: lang, translationEn: null }
    return { language: lang, translationEn: translation.slice(0, 6000) }
  } catch (err: any) {
    console.warn('[widget-translation] Haiku call failed:', err?.message)
    return null
  }
}

/**
 * Detect + translate a persisted WidgetMessage, write the result
 * back to the row, and broadcast a `translation_update` SSE event
 * so the operator inbox refreshes that message in place.
 *
 * Fire-and-forget. Errors logged, never thrown.
 */
export async function translateMessageInBackground(messageId: string): Promise<void> {
  try {
    const msg = await db.widgetMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, content: true, kind: true, language: true } as any,
    }) as any
    if (!msg) return
    // Skip non-text messages — image and product cards aren't worth
    // translating, and the kind field tells us up front.
    if (msg.kind && msg.kind !== 'text') return
    // Already detected? Don't re-run.
    if (msg.language) return

    const result = await detectAndTranslate(msg.content)
    if (!result) return

    await db.widgetMessage.update({
      where: { id: messageId },
      data: { language: result.language, translationEn: result.translationEn } as any,
    })

    await broadcast(msg.conversationId, {
      type: 'translation_update',
      id: messageId,
      language: result.language,
      translationEn: result.translationEn,
    }).catch(() => {})
  } catch (err: any) {
    console.warn('[widget-translation] background translate failed for', messageId, err?.message)
  }
}
