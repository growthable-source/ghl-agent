/**
 * Detects when the agent's reply CLAIMS an action or promises future action
 * without actually committing to it through a real mechanism.
 *
 * Two failure modes:
 *
 * 1. Past-tense hallucination — "I've booked you for Tuesday at 2pm"
 *    without ever calling book_appointment. Pure lie.
 *
 * 2. Unanchored future promise — "Let me get back to you with options
 *    shortly" without (a) scheduling a follow-up, (b) creating a task
 *    for a human, or (c) any other concrete commitment.
 *
 *    The agent DOES have mechanisms to come back: schedule_followup,
 *    agent triggers, new inbound webhooks. But it has to USE one of
 *    them. Saying "I'll be back" without reaching for any mechanism
 *    is the same as not coming back.
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

const FOLLOWUP_CLAIM = /\bi'?ve\s+scheduled\s+a\s+follow[\s-]?up\b|\bi'?ll\s+(follow\s+up|circle\s+back|check\s+in|remind\s+you)\s+(in|on|at|tomorrow|next)\s+\d/i

// ─── Deferred action — promises to do something "later" that the agent
// cannot actually do later because this is a synchronous turn. The agent
// has no async mechanism to come back unless a follow-up is scheduled.
// These patterns force the agent to do it NOW in this same turn.
const DEFERRED_CHECK_AVAILABILITY = /\b(let me\s+(check|see|find|look|pull\s+up|grab|get)|i'?ll\s+(check|see|find|look|pull\s+up|grab|get|go\s+(check|find|look))|one\s+(moment|sec|second|minute)\s+while\s+i\s+(check|find|look|pull))\b[^.!?]{0,80}\b(time|times|slot|slots|availability|available|calendar|schedule|options|opening|openings)\b|\bchecking\s+(for|the|our|your|other|some|more)\s+[^.!?]{0,60}\b(time|times|slot|slots|availability|available)\b|\blet me\s+(get back to you|come back to you|reach back)\s+[^.!?]*(options|times|slots|availability)/i

const DEFERRED_GENERIC = /\bi'?ll\s+(get back to you|come back to you|reach back|follow up with you|be back in touch|be right back|get right back|check on that|look into (that|it)|find out)\s*(shortly|soon|in a (bit|moment|minute|sec|second)|momentarily)?\b|\blet me\s+(get back to you|come back to you|reach back)\b|\bgive me\s+(a|one)\s+(moment|sec|second|minute)\b(?![^.!?]*\btool\b)/i

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

  // ─── Deferred availability check — "let me check other times" ───
  // If the agent promises to look up slots but has `get_available_slots`
  // available right now, it should just use the tool in this turn. No
  // reason to defer what can be done instantly.
  if (
    DEFERRED_CHECK_AVAILABILITY.test(reply) &&
    availableTools.includes('get_available_slots') &&
    !actionsPerformed.includes('get_available_slots')
  ) {
    const match = reply.match(DEFERRED_CHECK_AVAILABILITY)
    return {
      tool: 'get_available_slots',
      phrase: match?.[0] || '',
      correction:
        `You said "${match?.[0]?.trim() || 'let me check'}" but you did NOT call get_available_slots. ` +
        `The get_available_slots tool is instant — there is no reason to defer this to "later". ` +
        `Call get_available_slots RIGHT NOW using the calendarId from your Calendar Configuration section, then propose ONE specific time in your reply. ` +
        `The contact should see the new options in the same message, not "I'll get back to you".`,
    }
  }

  // ─── Unanchored future promise — "I'll get back to you" ───
  // The agent CAN come back — via schedule_followup, triggers, or when
  // the contact replies again. But making a vague promise without any
  // concrete mechanism (no tool called, no time committed) leaves the
  // contact hanging. If schedule_followup is available, use it. Otherwise
  // be honest about when/how they'll hear back.
  if (DEFERRED_GENERIC.test(reply)) {
    const match = reply.match(DEFERRED_GENERIC)
    const canScheduleFollowUp = availableTools.includes('schedule_followup')

    if (canScheduleFollowUp && !actionsPerformed.includes('schedule_followup')) {
      return {
        tool: 'schedule_followup',
        phrase: match?.[0] || '',
        correction:
          `You said "${match?.[0]?.trim() || "you'd get back"}" but you did not actually schedule a follow-up. ` +
          `You CAN come back to this contact — but only by scheduling it. Either: ` +
          `(a) call schedule_followup NOW to commit to a concrete return time, then tell the contact exactly when they'll hear back (e.g. "I'll check in tomorrow at 10am"); OR ` +
          `(b) answer their question in this turn using the tools and knowledge you already have. ` +
          `Don't make a vague promise without the schedule_followup tool backing it up.`,
      }
    }

    // No follow-up tool — the agent must either answer now or escalate to a human.
    return {
      tool: 'send_reply',
      phrase: match?.[0] || '',
      correction:
        `You said "${match?.[0]?.trim() || "you'd get back"}" but you don't have schedule_followup enabled, so you have no way to guarantee a return. ` +
        `Either answer the contact's question in this turn using your available tools (${availableTools.slice(0, 5).join(', ')}${availableTools.length > 5 ? '…' : ''}) and knowledge base, ` +
        `OR be explicit about the handoff: "I'll have someone from our team reach out to you directly." Don't leave a vague open-ended promise.`,
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
      return "I'm having a little trouble pulling up our calendar right now — can you let me know what day and time works best for you, and I'll get it confirmed?"
    case 'get_available_slots':
      return "Our calendar system is slow at the moment — what day and rough time would work best for you? I'll get back to you with confirmation as soon as I can."
    case 'update_contact_tags':
      return "Got it — noted."
    case 'create_opportunity':
      return "Thanks — I'll get that set up on our side."
    case 'schedule_followup':
      return "What's the best time for me to reach out with an update — later today, or tomorrow morning?"
    default:
      return "Let me rethink that — could you tell me a bit more about what you're looking for?"
  }
}
