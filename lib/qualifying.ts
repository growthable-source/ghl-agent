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

export function buildQualifyingPromptBlock(unanswered: QualifyingQuestion[]): string {
  if (unanswered.length === 0) return ''
  const list = unanswered.map((q, i) => `${i + 1}. ${q.question} (field: ${q.fieldKey})`).join('\n')
  return `\n\n## Qualifying Questions\nYou must gather answers to these questions before taking any goal action (booking, moving pipeline stage, etc). Ask them naturally in conversation — one at a time, not all at once:\n\n${list}`
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
