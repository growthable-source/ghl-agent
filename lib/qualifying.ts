import { db } from './db'
import { updateContactField, getContact, addTagsToContact } from './crm-client'
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

  const conditionDesc = (() => {
    switch (q.conditionOp) {
      case 'is_yes': return 'they say yes'
      case 'is_no': return 'they say no'
      case 'contains': return `their answer contains "${q.conditionVal}"`
      case 'equals': return `their answer is "${q.conditionVal}"`
      case 'gt': return `their answer is greater than ${q.conditionVal}`
      case 'lt': return `their answer is less than ${q.conditionVal}`
      case 'any': return 'they answer'
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
      default: return ''
    }
  })()

  if (!conditionDesc || !actionDesc) return ''
  return ` → If ${conditionDesc}, ${actionDesc}.`
}

export function buildQualifyingPromptBlock(unanswered: QualifyingQuestion[]): string {
  if (unanswered.length === 0) return ''

  const list = unanswered.map((q, i) => {
    let line = `${i + 1}. ${q.question} (field: ${q.fieldKey})`
    if (q.answerType === 'yes_no') line += ' [Expected: yes or no]'
    if (q.answerType === 'number') line += ' [Expected: a number]'
    if (q.answerType === 'choice' && q.choices?.length) line += ` [Options: ${q.choices.join(', ')}]`
    line += describeCondition(q)
    return line
  }).join('\n')

  return `\n\n## Qualifying Questions\nAsk these questions naturally — one at a time. Follow the specified actions based on the contact's answers:\n\n${list}`
}

export async function saveQualifyingAnswer(
  agentId: string,
  contactId: string,
  fieldKey: string,
  answer: string,
  locationId?: string
) {
  // 1. Find the question to get ghlFieldKey + overwrite setting
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
    if (question?.ghlFieldKey && locationId && !contactId.startsWith('playground-')) {
      try {
        // Check if we should overwrite existing value
        if (!question.overwrite) {
          const contact = await getContact(locationId, contactId)
          const existingVal = (contact as any)[question.ghlFieldKey] ||
            (contact as any).customFields?.find((f: any) => f.key === question.ghlFieldKey)?.value
          if (existingVal) return // Keep first answer — field already has a value
        }
        await updateContactField(locationId, contactId, question.ghlFieldKey, answer)
      } catch (err) {
        console.error(`[Qualifying] Failed to update GHL field ${question.ghlFieldKey}:`, err)
      }
    }
  }
}

export async function executeQualifyingAction(
  agentId: string,
  fieldKey: string,
  answer: string,
  contactId: string,
  locationId: string
): Promise<{ actionType: string; actionValue?: string } | null> {
  const question = await db.qualifyingQuestion.findFirst({
    where: { agentId, fieldKey },
  })

  if (!question?.conditionOp || !question?.actionType) return null

  // Evaluate condition
  const normalised = answer.trim().toLowerCase()
  let conditionMet = false
  switch (question.conditionOp) {
    case 'any':      conditionMet = true; break
    case 'is_yes':   conditionMet = ['yes', 'y', 'yeah', 'yep', 'yup', 'sure', 'absolutely', 'definitely'].includes(normalised); break
    case 'is_no':    conditionMet = ['no', 'n', 'nope', 'nah', 'not really'].includes(normalised); break
    case 'contains': conditionMet = !!question.conditionVal && normalised.includes(question.conditionVal.toLowerCase()); break
    case 'equals':   conditionMet = !!question.conditionVal && normalised === question.conditionVal.toLowerCase(); break
    case 'gt':       conditionMet = !!question.conditionVal && parseFloat(answer) > parseFloat(question.conditionVal); break
    case 'lt':       conditionMet = !!question.conditionVal && parseFloat(answer) < parseFloat(question.conditionVal); break
  }

  if (!conditionMet) return null

  // Execute action
  try {
    switch (question.actionType) {
      case 'tag':
        if (question.actionValue) {
          await addTagsToContact(locationId, contactId, [question.actionValue])
        }
        break
      case 'stop':
        // Signal to caller that we should stop/hand off — the agent will handle this
        break
      case 'book':
      case 'continue':
        // These are handled by the agent itself based on the returned action
        break
    }
  } catch (err) {
    console.error(`[Qualifying] Failed to execute action ${question.actionType}:`, err)
  }

  return { actionType: question.actionType, actionValue: question.actionValue ?? undefined }
}
