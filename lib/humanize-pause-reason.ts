/**
 * Translate the internal pauseReason strings (the format written by
 * pauseConversation() and the stop-condition evaluator) into a
 * short, operator-friendly label + longer description. Used by the
 * Needs Attention page and anywhere else we surface pause status.
 *
 * Known string shapes (see lib/conversation-state.ts + lib/routing.ts
 * stop-condition branches):
 *   'human_takeover'
 *   'APPOINTMENT_BOOKED'
 *   'KEYWORD:<comma,separated,list>'
 *   'MESSAGE_COUNT:<n>'
 *   'OPPORTUNITY_STAGE:<stageId>'
 *   'SENTIMENT:hostile'
 *   'SENTIMENT:custom'
 *   'condition_met'         ← when the evaluator returned null reason
 *   'manual'                ← explicit pause API call
 */

export interface HumanizedReason {
  short: string        // e.g. "Hostile language"
  long: string         // e.g. "Contact used language matching our hostile-customer pattern (hate, lawyer, etc.)."
  tone: 'human' | 'stop-condition' | 'error' | 'neutral'
}

export function humanizePauseReason(raw: string | null | undefined): HumanizedReason {
  const reason = (raw ?? '').trim()
  if (!reason) {
    return { short: 'Paused', long: 'The conversation is paused, but no reason was recorded.', tone: 'neutral' }
  }

  if (reason === 'human_takeover') {
    return {
      short: 'Human takeover',
      long: 'A human took over this conversation and the agent is waiting for them to hand it back.',
      tone: 'human',
    }
  }

  if (reason === 'manual') {
    return {
      short: 'Manually paused',
      long: 'An operator paused this conversation explicitly from the dashboard.',
      tone: 'human',
    }
  }

  if (reason === 'APPOINTMENT_BOOKED') {
    return {
      short: 'Appointment booked',
      long: 'Stop condition fired because the agent successfully booked an appointment.',
      tone: 'stop-condition',
    }
  }

  if (reason.startsWith('KEYWORD:')) {
    const list = reason.slice('KEYWORD:'.length)
    return {
      short: 'Keyword matched',
      long: `Stop condition fired because the inbound message contained a configured keyword (${list}).`,
      tone: 'stop-condition',
    }
  }

  if (reason.startsWith('MESSAGE_COUNT:')) {
    const limit = reason.slice('MESSAGE_COUNT:'.length)
    return {
      short: 'Message limit',
      long: `Stop condition fired because the conversation hit ${limit} messages without resolution.`,
      tone: 'stop-condition',
    }
  }

  if (reason.startsWith('OPPORTUNITY_STAGE:')) {
    return {
      short: 'Pipeline stage change',
      long: 'Stop condition fired because the agent moved the contact to a pipeline stage that hands off to a human.',
      tone: 'stop-condition',
    }
  }

  if (reason === 'SENTIMENT:hostile') {
    return {
      short: 'Hostile sentiment',
      long: 'Stop condition fired because the contact used hostile / angry language (hate, lawyer, scam, refund demand, profanity, etc.). A human should probably step in before the agent replies again.',
      tone: 'stop-condition',
    }
  }

  if (reason === 'SENTIMENT:custom') {
    return {
      short: 'Sentiment keyword',
      long: 'Stop condition fired because the inbound matched a custom hostile-keyword you configured on the sentiment stop condition.',
      tone: 'stop-condition',
    }
  }

  if (reason === 'condition_met') {
    return {
      short: 'Stop condition',
      long: 'A stop condition fired, but the specific reason was not recorded. Check the agent\'s Stop Conditions tab for context.',
      tone: 'stop-condition',
    }
  }

  if (reason.startsWith('Transfer to human:')) {
    // The transfer_to_human tool writes the agent's own summary into
    // the pause reason. Preserve the summary, just strip the prefix.
    return {
      short: 'Agent asked for help',
      long: `The agent called transfer_to_human itself with the note: "${reason.slice('Transfer to human:'.length).trim()}"`,
      tone: 'human',
    }
  }

  // Fall-through — unknown format, just surface the raw string so an
  // operator can still pattern-match it even if we forgot to map it.
  return { short: 'Paused', long: reason, tone: 'neutral' }
}
