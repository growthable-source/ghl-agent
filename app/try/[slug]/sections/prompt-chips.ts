/**
 * "Demo prompts" chips shown in the Prompts section (and doubling as the
 * pitch for what a visitor can ask). Vertical-aware with a generic
 * (café-flavored, per the Figma reference) fallback — same resolution
 * pattern as ASK_ME_EXAMPLES used to have: vertical key, else default.
 */
export const PROMPT_CHIPS: Record<string, string[]> = {
  'med-spa': [
    'What are your opening hours?',
    'Can I book a consultation this week?',
    'Do you offer consultations before treatment?',
    'Is there parking nearby?',
    'Do you take walk-ins?',
    "What's your most popular treatment?",
    'Can I speak to a manager?',
    'Do you do group bookings?',
  ],
  gym: [
    'What are your opening hours?',
    'Can I try a free class this week?',
    'Do you offer personal training?',
    'Is there parking nearby?',
    'Do you take walk-ins?',
    'What membership plans do you have?',
    'Can I speak to a manager?',
    'Do you run group classes?',
  ],
  default: [
    'What are your opening hours?',
    'Can I book a table for 6 tonight?',
    'Do you cater for vegans?',
    'Is there parking nearby?',
    'Do you take walk-ins?',
    "What's the best dish on the menu?",
    'Can I speak to a manager?',
    'Do you do private events?',
  ],
}

export function promptChipsForVertical(vertical: string | null | undefined): string[] {
  return (vertical && PROMPT_CHIPS[vertical]) || PROMPT_CHIPS.default
}
