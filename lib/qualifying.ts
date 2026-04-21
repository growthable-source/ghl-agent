import { db } from './db'
import {
  updateContactField, getContact, addTagsToContact,
  updateOpportunityStatus, updateOpportunityValue,
  addContactToWorkflow, removeContactFromWorkflow,
  markContactDnd,
  getOpportunitiesForContact,
} from './crm-client'
import type { QualifyingQuestion } from '@prisma/client'

export async function getAllQuestions(agentId: string): Promise<QualifyingQuestion[]> {
  return db.qualifyingQuestion.findMany({
    where: { agentId },
    orderBy: { order: 'asc' },
  })
}

export async function getUnansweredQuestions(agentId: string, contactId: string): Promise<QualifyingQuestion[]> {
  const [questions, state] = await Promise.all([
    db.qualifyingQuestion.findMany({
      where: { agentId, required: true },
      orderBy: { order: 'asc' },
    }),
    db.conversationStateRecord.findUnique({
      where: { agentId_contactId: { agentId, contactId } },
    }),
  ])

  if (questions.length === 0) return []

  const answered = (state?.qualifyingAnswers as Record<string, string>) ?? {}
  return questions.filter(q => !answered[q.fieldKey])
}

function describeCondition(q: QualifyingQuestion): string {
  if (!q.conditionOp || !q.actionType) return ''

  const params = (q as any).actionParams as Record<string, any> | null
  const multi = (q as any).conditionValues as string[] | undefined

  const conditionDesc = (() => {
    switch (q.conditionOp) {
      case 'is_yes': return 'they say yes'
      case 'is_no': return 'they say no'
      case 'contains': return `their answer contains "${q.conditionVal}"`
      case 'equals': return `their answer is "${q.conditionVal}"`
      case 'gt': return `their answer is greater than ${q.conditionVal}`
      case 'lt': return `their answer is less than ${q.conditionVal}`
      case 'any': return 'they answer'
      case 'is_any_of': {
        const list = multi ?? []
        if (list.length === 0) return 'they answer'
        if (list.length === 1) return `their answer is "${list[0]}"`
        return `their answer is any of: ${list.map(v => `"${v}"`).join(', ')}`
      }
      default: return ''
    }
  })()

  const actionDesc = (() => {
    switch (q.actionType) {
      case 'tag': return `tag the contact with "${q.actionValue}"`
      case 'stage': return `move to pipeline stage "${q.actionValue}"`
      case 'book': return 'proceed to book an appointment'
      case 'stop': return 'stop and hand off to a human'
      case 'continue': return 'continue normally'
      case 'add_to_workflow': {
        const names = (params?.workflowNames as string[]) ?? []
        if (names.length === 0) return 'add the contact to a workflow'
        return `enrol the contact in ${names.map(n => `"${n}"`).join(', ')}`
      }
      case 'remove_from_workflow': {
        const names = (params?.workflowNames as string[]) ?? []
        if (names.length === 0) return 'remove the contact from a workflow'
        return `remove the contact from ${names.map(n => `"${n}"`).join(', ')}`
      }
      case 'opportunity_status': return `mark the opportunity as ${params?.status ?? 'updated'}`
      case 'opportunity_value': return `set the opportunity value to ${params?.monetaryValue ?? 0}`
      case 'dnd_channel': return `mark the contact DND on ${params?.channel ?? 'this channel'}`
      default: return ''
    }
  })()

  if (!conditionDesc || !actionDesc) return ''
  return ` → If ${conditionDesc}, ${actionDesc}.`
}

export type QualifyingStyle = 'strict' | 'natural'

/**
 * Optional merge-field context. When provided, each question string is
 * rendered through renderMergeFields so tokens like
 * {{contact.first_name|there}} become real names before the agent
 * quotes the question. Callers without contact info (sandbox, missing
 * CRM) pass undefined — the LLM sees tokens verbatim and may or may
 * not paper over them.
 */
export function buildQualifyingPromptBlock(
  unanswered: QualifyingQuestion[],
  style: QualifyingStyle = 'strict',
  mergeCtx?: {
    contact?: any
    agent?: { name?: string | null } | null
    user?: any
    timezone?: string | null
  },
): string {
  if (unanswered.length === 0) return ''

  // Lazy-require the renderer so the zero-questions fast path stays cheap.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renderMergeFields } = require('./merge-fields') as typeof import('./merge-fields')

  const list = unanswered.map((q, i) => {
    const rendered = mergeCtx
      ? renderMergeFields(q.question, {
          contact: mergeCtx.contact ?? null,
          agent: mergeCtx.agent ?? null,
          user: mergeCtx.user ?? null,
          timezone: mergeCtx.timezone ?? null,
        })
      : q.question
    let line = `${i + 1}. ${rendered} (field: ${q.fieldKey})`
    if (q.answerType === 'yes_no') line += ' [Expected: yes or no]'
    if (q.answerType === 'number') line += ' [Expected: a number]'
    if (q.answerType === 'choice' && q.choices?.length) line += ` [Options: ${q.choices.join(', ')}]`
    line += describeCondition(q)
    return line
  }).join('\n')

  if (style === 'natural') {
    return `\n\n## Qualifying Questions\n\nWork these questions into the conversation naturally as the opportunity arises. Rules:\n- Ask ONE question at a time — don't stack them.\n- After the contact answers, call \`save_qualifying_answer\` with the fieldKey and their answer.\n- You don't have to ask them in order — use your judgement on timing.\n- It's OK to answer the contact's questions or discuss other topics in between.\n- Try to cover all of them by the end of the conversation, but don't force it if the contact is moving in a different direction.\n\nQuestions to cover:\n\n${list}`
  }

  return `\n\n## REQUIRED: Qualifying Questions — You Must Ask These\n\nBefore doing anything else, you MUST work through every question below in order. Rules:\n- Ask ONE question at a time. Do not ask multiple questions in a single message.\n- After the contact answers, immediately call \`save_qualifying_answer\` with the fieldKey and their answer.\n- Then ask the next question. Do not skip ahead.\n- Do not answer other topics or proceed with any task until ALL questions are asked and saved.\n- Weave them naturally into conversation — but do not omit them.\n\nQuestions to ask:\n\n${list}`
}

export async function saveQualifyingAnswer(
  agentId: string,
  contactId: string,
  fieldKey: string,
  answer: string,
  locationId?: string
) {
  // 1. Find the question to get crmFieldKey + overwrite setting
  const question = await db.qualifyingQuestion.findFirst({
    where: { agentId, fieldKey },
  })

  // 2. Get existing answers
  const state = await db.conversationStateRecord.findUnique({
    where: { agentId_contactId: { agentId, contactId } },
  })
  const existing = (state?.qualifyingAnswers as Record<string, string>) ?? {}

  // 3. Apply overwrite logic: if overwrite is false and we already have an answer, skip update
  const shouldUpdate = question?.overwrite !== false || !existing[fieldKey]

  if (shouldUpdate) {
    // Save to DB
    await db.conversationStateRecord.update({
      where: { agentId_contactId: { agentId, contactId } },
      data: { qualifyingAnswers: { ...existing, [fieldKey]: answer } },
    })

    // Write to GHL contact field if configured and not a sandbox contact
    if (question?.crmFieldKey && locationId && !contactId.startsWith('playground-')) {
      try {
        // Check if we should overwrite existing value
        if (!question.overwrite) {
          const contact = await getContact(locationId, contactId)
          const existingVal = (contact as any)[question.crmFieldKey] ||
            (contact as any).customFields?.find((f: any) => f.key === question.crmFieldKey)?.value
          if (existingVal) return // Keep first answer — field already has a value
        }
        await updateContactField(locationId, contactId, question.crmFieldKey, answer)
      } catch (err) {
        console.error(`[Qualifying] Failed to update GHL field ${question.crmFieldKey}:`, err)
      }
    }
  }
}

export async function executeQualifyingAction(
  agentId: string,
  fieldKey: string,
  answer: string,
  contactId: string,
  locationId: string,
  /** Channel the conversation is currently on — used by dnd_channel when
   *  the action doesn't specify one. Safe to omit. */
  currentChannel?: string,
): Promise<{ actionType: string; actionValue?: string } | null> {
  const question = await db.qualifyingQuestion.findFirst({
    where: { agentId, fieldKey },
  })

  if (!question?.conditionOp || !question?.actionType) return null

  // Evaluate condition
  const normalised = answer.trim().toLowerCase()
  const multi = ((question as any).conditionValues as string[] | undefined) ?? []
  let conditionMet = false
  switch (question.conditionOp) {
    case 'any':      conditionMet = true; break
    case 'is_yes':   conditionMet = ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'absolutely', 'definitely'].includes(normalised); break
    case 'is_no':    conditionMet = ['no', 'n', 'nope', 'nah', 'not really'].includes(normalised); break
    case 'contains': conditionMet = !!question.conditionVal && normalised.includes(question.conditionVal.toLowerCase()); break
    case 'equals':   conditionMet = !!question.conditionVal && normalised === question.conditionVal.toLowerCase(); break
    case 'gt':       conditionMet = !!question.conditionVal && parseFloat(answer) > parseFloat(question.conditionVal); break
    case 'lt':       conditionMet = !!question.conditionVal && parseFloat(answer) < parseFloat(question.conditionVal); break
    case 'is_any_of':
      // Case-insensitive match against one of the configured allowed values.
      conditionMet = multi.some(v => v.trim().toLowerCase() === normalised)
      break
  }

  if (!conditionMet) return null

  const params = ((question as any).actionParams as Record<string, any> | null) ?? {}

  // Execute action. Errors are logged but not thrown — a misconfigured
  // action should never break the agent's reply path.
  try {
    switch (question.actionType) {
      case 'tag':
        if (question.actionValue) {
          await addTagsToContact(locationId, contactId, [question.actionValue])
        }
        break

      case 'stop':
      case 'book':
      case 'continue':
        // Handled by the agent based on the returned actionType.
        break

      case 'add_to_workflow': {
        const ids = (params.workflowIds as string[]) ?? []
        for (const id of ids) {
          try { await addContactToWorkflow(locationId, contactId, id) }
          catch (err) { console.error(`[Qualifying] add_to_workflow ${id} failed:`, err) }
        }
        break
      }

      case 'remove_from_workflow': {
        const ids = (params.workflowIds as string[]) ?? []
        for (const id of ids) {
          try { await removeContactFromWorkflow(locationId, contactId, id) }
          catch (err) { console.error(`[Qualifying] remove_from_workflow ${id} failed:`, err) }
        }
        break
      }

      case 'opportunity_status': {
        // Applies to every open opportunity for the contact — a contact
        // typically has 0 or 1, but we iterate to be safe.
        const status = (params.status as 'open' | 'won' | 'lost' | 'abandoned' | undefined) ?? 'won'
        const opps = await getOpportunitiesForContact(locationId, contactId).catch(() => [])
        for (const opp of opps ?? []) {
          try { await updateOpportunityStatus(locationId, opp.id, status) }
          catch (err) { console.error(`[Qualifying] opportunity_status ${opp.id} failed:`, err) }
        }
        break
      }

      case 'opportunity_value': {
        const value = typeof params.monetaryValue === 'number'
          ? params.monetaryValue
          : parseFloat(String(params.monetaryValue ?? ''))
        if (!Number.isFinite(value)) break
        const opps = await getOpportunitiesForContact(locationId, contactId).catch(() => [])
        for (const opp of opps ?? []) {
          try { await updateOpportunityValue(locationId, opp.id, value) }
          catch (err) { console.error(`[Qualifying] opportunity_value ${opp.id} failed:`, err) }
        }
        break
      }

      case 'dnd_channel': {
        // Action-specified channel wins; otherwise use the conversation's
        // current channel. If neither is known, mark global DND.
        const channel = (params.channel as string | undefined) ?? currentChannel
        try { await markContactDnd(locationId, contactId, channel) }
        catch (err) { console.error(`[Qualifying] dnd_channel failed:`, err) }
        break
      }
    }
  } catch (err) {
    console.error(`[Qualifying] Failed to execute action ${question.actionType}:`, err)
  }

  return { actionType: question.actionType, actionValue: question.actionValue ?? undefined }
}
