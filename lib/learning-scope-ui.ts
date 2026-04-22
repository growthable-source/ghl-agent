/**
 * Shared display helpers for PlatformLearning scopes.
 *
 * Kept in lib/ (not components/) so both server and client components
 * can import the type-safe helpers without dragging in any React.
 */

export type LearningScope = 'this_agent' | 'workspace' | 'all_agents'

/**
 * Border + background + text colour classes for a scope chip. Visual
 * weight escalates with blast radius — all_agents is purple specifically
 * so approvers notice before nodding through a global change.
 */
export function scopeChipClass(scope: string): string {
  if (scope === 'all_agents') return 'text-purple-300 bg-purple-500/15 border-purple-500/40'
  if (scope === 'workspace') return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
  return 'text-zinc-400 bg-zinc-900 border-zinc-800'
}

/**
 * Human-readable scope label for chips and prose copy. "this_agent" →
 * "this agent", etc. Plain-text only — no styling.
 */
export function scopeLabel(scope: string): string {
  return scope.replace(/_/g, ' ')
}
