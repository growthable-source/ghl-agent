/**
 * Detects when the agent's reply CLAIMS an action was taken but no
 * corresponding tool was actually called. This is a common LLM failure
 * mode — the model confidently says "I've booked you for Tuesday at 2pm"
 * without ever invoking `book_appointment`, which means nothing actually
 * happened in the CRM.
 *
 * Returns a corrective instruction string that can be fed back into the
 * agent loop as a user message to force it to either (a) call the tool
 * or (b) correct its reply.
 */

export interface ClaimDetection {
  tool: string
  phrase: string
  correction: string
}

// Regex patterns that strongly suggest a completed action (past / perfect / stative)
const BOOKING_CLAIM = /\b(i'?ve|i have|you'?re|you are|we'?re|we have)\s+(now\s+|all\s+|just\s+|successfully\s+|already\s+)?(booked|scheduled|confirmed|reserved|set\s+up|got\s+(you|us)\s+(in|down|on|scheduled)|locked\s+in)\b|\byour\s+(appointment|call|meeting|demo|consultation|slot)\s+(is|has\s+been)\s+(booked|scheduled|confirmed|set)\b|\bappointment\s+(is\s+)?confirmed\b|\ball\s+(booked|scheduled|set)\b|\bsee\s+you\s+(then|on)\b/i

const TAG_CLAIM = /\b(i'?ve|i have)\s+(added|tagged|marked|flagged|labeled)\b|\btagged\s+you\s+(as|with)\b|\badded\s+the\s+[a-z0-9-]+\s+tag\b/i

const OPPORTUNITY_CLAIM = /\b(i'?ve|i have)\s+(created|opened|started|made)\s+(an?\s+)?(opportunity|deal|pipeline\s+entry)\b|\bopportunity\s+has\s+been\s+(created|opened)\b/i

const NOTE_CLAIM = /\b(i'?ve|i have)\s+(added|saved|recorded|logged)\s+(a|the)\s+note\b/i

const FOLLOWUP_CLAIM = /\bi'?ll\s+(follow\s+up|circle\s+back|check\s+in|remind\s+you)\s+(in|on|at|tomorrow|next)\b|\bi'?ve\s+scheduled\s+a\s+follow[\s-]?up\b/i

/**
 * If the reply claims an action but no matching tool was called, return a
 * corrective instruction. Returns null when claims and actions agree.
 */
export function detectFalseActionClaim(
  reply: string,
  actionsPerformed: string[],
  availableTools: string[],
): ClaimDetection | null {
  if (!reply) return null

  // Booking: the most common + most damaging failure mode
  if (
    BOOKING_CLAIM.test(reply) &&
    availableTools.includes('book_appointment') &&
    !actionsPerformed.includes('book_appointment')
  ) {
    const match = reply.match(BOOKING_CLAIM)
    return {
      tool: 'book_appointment',
      phrase: match?.[0] || '',
      correction:
        `CRITICAL: Your previous reply said "${match?.[0]?.trim() || 'you booked the appointment'}" but you did NOT call the book_appointment tool. NOTHING has actually been booked — the contact will show up to a meeting that does not exist in the calendar. ` +
        `You MUST call book_appointment RIGHT NOW using:\n` +
        `- calendarId: the one in your Calendar Configuration section\n` +
        `- contactId: the one in your Calendar Configuration section\n` +
        `- startTime: the exact ISO string returned by get_available_slots (if you haven't called it yet this turn, call it first and pick a slot)\n\n` +
        `Do not send any more text to the contact until book_appointment returns { success: true }.`,
    }
  }

  // Tag
  if (
    TAG_CLAIM.test(reply) &&
    availableTools.includes('update_contact_tags') &&
    !actionsPerformed.includes('update_contact_tags')
  ) {
    return {
      tool: 'update_contact_tags',
      phrase: reply.match(TAG_CLAIM)?.[0] || '',
      correction:
        `Your reply claimed the contact was tagged, but you did not call update_contact_tags. Call it now with the appropriate tag(s), then continue.`,
    }
  }

  // Opportunity
  if (
    OPPORTUNITY_CLAIM.test(reply) &&
    availableTools.includes('create_opportunity') &&
    !actionsPerformed.includes('create_opportunity')
  ) {
    return {
      tool: 'create_opportunity',
      phrase: reply.match(OPPORTUNITY_CLAIM)?.[0] || '',
      correction:
        `Your reply claimed to create an opportunity, but you did not call create_opportunity. Call it now with pipelineId, pipelineStageId, and a descriptive name.`,
    }
  }

  // Note
  if (
    NOTE_CLAIM.test(reply) &&
    availableTools.includes('add_contact_note') &&
    !actionsPerformed.includes('add_contact_note') &&
    !actionsPerformed.includes('create_appointment_note')
  ) {
    return {
      tool: 'add_contact_note',
      phrase: reply.match(NOTE_CLAIM)?.[0] || '',
      correction:
        `Your reply claimed you recorded a note, but you did not call add_contact_note. Call it now.`,
    }
  }

  // Follow-up scheduling claim
  if (
    FOLLOWUP_CLAIM.test(reply) &&
    availableTools.includes('schedule_followup') &&
    !actionsPerformed.includes('schedule_followup')
  ) {
    return {
      tool: 'schedule_followup',
      phrase: reply.match(FOLLOWUP_CLAIM)?.[0] || '',
      correction:
        `Your reply said you'd follow up, but you didn't schedule one via the schedule_followup tool. Call it now.`,
    }
  }

  return null
}

/**
 * A safe fallback reply to send to the contact when we've exhausted retries
 * and the model still refuses to call the required tool. This prevents us
 * from sending the hallucinated claim to the contact.
 */
export function safeFallbackReply(detection: ClaimDetection): string {
  switch (detection.tool) {
    case 'book_appointment':
      return "Let me get that scheduled for you — one moment while I pull up availability."
    case 'update_contact_tags':
      return "Got it — noted."
    case 'create_opportunity':
      return "Thanks — I'll get that set up on our side."
    default:
      return "One moment while I take care of that."
  }
}
