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
  // Specific case: the agent promises to look up more slots but didn't
  // actually call get_available_slots in this turn.
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
        `CRITICAL: Your reply said "${match?.[0]?.trim() || 'let me check'}" but you did NOT call get_available_slots. ` +
        `This is a SYNCHRONOUS conversation — you cannot come back later. You have no async mechanism to "get back to" the contact. ` +
        `If you promise to check availability, you MUST call get_available_slots RIGHT NOW in this same turn and propose specific times in your reply. ` +
        `Never tell the contact to wait — act now. Call get_available_slots with the calendarId from your Calendar Configuration section, then propose ONE specific time.`,
    }
  }

  // ─── Deferred generic — "I'll get back to you" ───
  // Agent says it'll return later, but there is no return mechanism in a
  // synchronous SMS/chat turn. Either the agent needs to schedule a
  // follow-up (if the tool is available) or it needs to answer now.
  if (DEFERRED_GENERIC.test(reply)) {
    const match = reply.match(DEFERRED_GENERIC)
    const canScheduleFollowUp = availableTools.includes('schedule_followup')
    const canCheckSlots = availableTools.includes('get_available_slots')

    if (canScheduleFollowUp && !actionsPerformed.includes('schedule_followup')) {
      return {
        tool: 'schedule_followup',
        phrase: match?.[0] || '',
        correction:
          `You said "${match?.[0]?.trim() || "you'd get back"}" but you have no async mechanism to return to this contact without scheduling a follow-up. ` +
          `Either: (a) answer the contact's question RIGHT NOW using your available tools and knowledge — no "getting back later"; OR ` +
          `(b) if you truly can't answer now, call schedule_followup to schedule a concrete follow-up, then tell the contact exactly when they'll hear back (e.g. "tomorrow at 10am"). ` +
          `Never promise to come back without scheduling it — this is a synchronous conversation.`,
      }
    }

    // No follow-up tool? Must answer now.
    return {
      tool: canCheckSlots ? 'get_available_slots' : 'send_reply',
      phrase: match?.[0] || '',
      correction:
        `You said "${match?.[0]?.trim() || "you'd get back"}" but this is a synchronous conversation — there is no way for you to return to the contact later. ` +
        `You cannot say "I'll get back to you" because you won't. ` +
        `Use your available tools RIGHT NOW (${availableTools.slice(0, 5).join(', ')}${availableTools.length > 5 ? '…' : ''}) to answer the contact's question in this turn, or reply with a concrete answer/offer based on what you already know. ` +
        `Never promise future action you cannot deliver.`,
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
