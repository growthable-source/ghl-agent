/**
 * Curated subset of Lucide icons the visual brief is allowed to pick
 * from. Keeping the allowlist tight (~120 names) means:
 *   - Claude doesn't hallucinate icon names (the spec validates against
 *     this list and unknown picks fall back to a sensible default)
 *   - The renderer can safely import only what's in the list
 *   - Pages are visually coherent — every icon comes from the same
 *     hand-picked set, no random one-offs
 *
 * Categories chosen for landing-page idioms: speed/clock, security,
 * money, AI/tech, communication, productivity, success, growth.
 */

export const LUCIDE_ALLOWLIST = [
  // Speed / time / urgency
  'zap', 'rocket', 'gauge', 'clock', 'timer', 'hourglass', 'fast-forward',
  // Security / trust
  'shield', 'shield-check', 'lock', 'key', 'badge-check', 'verified', 'fingerprint',
  // Money / value
  'dollar-sign', 'banknote', 'wallet', 'piggy-bank', 'trending-up', 'trending-down', 'chart-line', 'chart-bar', 'percent',
  // Growth / success
  'target', 'trophy', 'star', 'sparkles', 'crown', 'award', 'medal', 'flag',
  // AI / tech
  'cpu', 'brain', 'bot', 'wand', 'magic-wand', 'wand-sparkles',
  // Communication
  'message-circle', 'message-square', 'mail', 'phone', 'send', 'megaphone', 'bell',
  // Productivity / tools
  'wrench', 'settings', 'cog', 'workflow', 'git-branch', 'layers', 'puzzle', 'box',
  // Data / analytics
  'database', 'server', 'cloud', 'globe', 'wifi', 'activity', 'pie-chart',
  // People / community
  'users', 'user-check', 'user-plus', 'handshake', 'heart', 'thumbs-up',
  // Calendar / scheduling
  'calendar', 'calendar-check', 'calendar-clock',
  // Documents / content
  'file-text', 'file-check', 'clipboard', 'clipboard-check', 'book-open', 'newspaper',
  // Action / movement
  'arrow-right', 'arrow-up-right', 'check', 'check-circle', 'circle-check', 'plus', 'play', 'play-circle',
  // Objects / scenarios
  'briefcase', 'building', 'home', 'store', 'shopping-cart', 'package', 'truck',
  // Lights / signals
  'lightbulb', 'flame', 'sun', 'eye', 'eye-off', 'search', 'filter',
  // Emotion / outcomes
  'smile', 'party-popper', 'gift',
  // Education
  'graduation-cap', 'school',
] as const

export type LucideIconName = (typeof LUCIDE_ALLOWLIST)[number]

const LUCIDE_SET: Set<string> = new Set(LUCIDE_ALLOWLIST)

/**
 * Returns the icon name if it's in the allowlist, else null. Used by
 * the spec normaliser to drop hallucinated icon names cleanly.
 */
export function pickAllowedIcon(name: unknown): LucideIconName | null {
  if (typeof name !== 'string') return null
  const normalized = name.trim().toLowerCase()
  if (LUCIDE_SET.has(normalized)) return normalized as LucideIconName
  // Tolerate camelCase / PascalCase (lucide-react exports PascalCase
  // components but names are kebab-case in their docs).
  const kebab = normalized
    .replace(/([A-Z])/g, '-$1')
    .replace(/^-/, '')
    .replace(/_/g, '-')
    .toLowerCase()
  if (LUCIDE_SET.has(kebab)) return kebab as LucideIconName
  return null
}
