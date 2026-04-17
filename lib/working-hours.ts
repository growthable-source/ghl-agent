/**
 * Working hours utilities for agents.
 *
 * An agent with workingHoursEnabled=true will only send outbound messages
 * during its configured window. Scheduled follow-ups that fall outside the
 * window get shifted to the next valid slot.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export interface WorkingHoursConfig {
  workingHoursEnabled: boolean
  workingHoursStart: number  // 0-23
  workingHoursEnd: number    // 0-24
  workingDays: string[]      // ["mon","tue",...]
  timezone: string | null
}

/**
 * Check if the given moment is within the agent's working window.
 * Uses the agent's timezone if set, otherwise system timezone.
 */
export function isWithinWorkingHours(config: WorkingHoursConfig, at: Date = new Date()): boolean {
  if (!config.workingHoursEnabled) return true

  // Use agent timezone if configured
  const tz = config.timezone || undefined
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  }
  const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(at)
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
  const weekdayShort = parts.find(p => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) ?? ''

  // Check day of week
  if (!config.workingDays.includes(weekdayShort)) return false
  // Check hour
  if (hour < config.workingHoursStart || hour >= config.workingHoursEnd) return false
  return true
}

/**
 * Shift a scheduled timestamp forward until it lands within working hours.
 * Returns the original time if already within hours.
 */
export function shiftToWorkingHours(config: WorkingHoursConfig, scheduledAt: Date): Date {
  if (!config.workingHoursEnabled) return scheduledAt

  const maxIterations = 14 // at most 2 weeks forward
  let attempt = new Date(scheduledAt)
  for (let i = 0; i < maxIterations; i++) {
    if (isWithinWorkingHours(config, attempt)) return attempt

    // Advance to the next working day's start hour
    const tz = config.timezone || undefined
    const opts: Intl.DateTimeFormatOptions = { timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short' }
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(attempt)
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0')
    const weekdayShort = (parts.find(p => p.type === 'weekday')?.value || '').toLowerCase().slice(0, 3)

    // If same day but before window: bump to start hour today
    if (config.workingDays.includes(weekdayShort) && hour < config.workingHoursStart) {
      attempt.setHours(config.workingHoursStart, 0, 0, 0)
    } else {
      // Otherwise advance to tomorrow's start hour
      attempt.setDate(attempt.getDate() + 1)
      attempt.setHours(config.workingHoursStart, 0, 0, 0)
    }
  }
  return attempt
}

export function formatWorkingHours(config: WorkingHoursConfig): string {
  if (!config.workingHoursEnabled) return 'Always available'
  const fmt = (h: number) => {
    const period = h >= 12 ? 'pm' : 'am'
    const hr = h % 12 === 0 ? 12 : h % 12
    return `${hr}${period}`
  }
  const days = config.workingDays.length === 7
    ? 'every day'
    : config.workingDays.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')
  return `${fmt(config.workingHoursStart)}–${fmt(config.workingHoursEnd)} · ${days}`
}

export { DAY_KEYS }
