import { db } from './db'
import type { QualifyingQuestion } from '@prisma/client'

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

export async function saveQualifyingAnswer(agentId: string, contactId: string, fieldKey: string, answer: string) {
  const state = await db.conversationStateRecord.findUnique({
    where: { agentId_contactId: { agentId, contactId } },
  })
  const existing = (state?.qualifyingAnswers as Record<string, string>) ?? {}
  await db.conversationStateRecord.update({
    where: { agentId_contactId: { agentId, contactId } },
    data: { qualifyingAnswers: { ...existing, [fieldKey]: answer } },
  })
}
