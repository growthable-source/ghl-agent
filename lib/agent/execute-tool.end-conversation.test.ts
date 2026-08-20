import { describe, it, expect, vi, beforeEach } from 'vitest'

// end_conversation must refuse to close a chat that's (a) waiting in the
// human queue (queuedAt set, assignedUserId null) — closing drops the
// visitor from the queue — OR (b) currently handed off to a human
// (status 'handed_off') — the AI closing it out from under the agent is
// the reported "AI closes the chat after it's assigned to an agent" bug.
// We key on status, NOT assignedUserId: assignedUserId isn't cleared
// when an operator hands the chat back to the AI, so guarding on it
// would permanently lock the AI out of closing a once-taken-over chat.

const update = vi.fn(async () => ({}))
const findUnique = vi.fn()

vi.mock('../db', () => ({
  db: {
    widgetConversation: {
      findUnique: (...a: any[]) => findUnique(...a),
      update: (...a: any[]) => update(...a),
    },
  },
}))

vi.mock('../widget-sse', () => ({ broadcast: vi.fn(async () => {}) }))

import { executeTool } from './execute-tool'

// Widget adapter carries the conversation id + broadcastSystem so the
// tool's widget-only guard passes and we reach the queue check.
function widgetAdapter(conversationId: string) {
  return { locationId: 'loc1', conversationId, broadcastSystem: () => {} } as any
}

async function endConversation() {
  return executeTool(
    'end_conversation',
    { summary: 'Visitor got what they needed.' },
    'loc1', false, undefined, 'widget', undefined, widgetAdapter('conv_1'),
    undefined, undefined, undefined, 'ws1',
  )
}

describe('end_conversation queue guard', () => {
  beforeEach(() => {
    update.mockClear()
    findUnique.mockReset()
  })

  it('refuses to close a chat queued for a human and does not update status', async () => {
    findUnique.mockResolvedValue({ queuedAt: new Date(), assignedUserId: null })
    const out = JSON.parse(await endConversation())
    expect(out.error).toMatch(/waiting in the queue/i)
    expect(update).not.toHaveBeenCalled()
  })

  it('closes a normal active chat (not queued)', async () => {
    findUnique.mockResolvedValue({ queuedAt: null, assignedUserId: null })
    const out = JSON.parse(await endConversation())
    expect(out.success).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('refuses to close a chat that is handed off to a human', async () => {
    findUnique.mockResolvedValue({ queuedAt: null, assignedUserId: 'u1', status: 'handed_off' })
    const out = JSON.parse(await endConversation())
    expect(out.error).toMatch(/taken it over|human teammate/i)
    expect(update).not.toHaveBeenCalled()
  })

  it('CAN close a chat that was assigned but handed back to the AI (status active) — no permanent lock', async () => {
    // assignedUserId lingers after an operator resumes the AI; the guard
    // must key on status, so an active chat is still closeable.
    findUnique.mockResolvedValue({ queuedAt: null, assignedUserId: 'u1', status: 'active' })
    const out = JSON.parse(await endConversation())
    expect(out.success).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('refuses to close when a handover was set up in the same turn (transfer_to_human + end)', async () => {
    // handoverCapture.captured means transfer_to_human ran this run —
    // the status hasn't flipped to handed_off yet, so this guard (not
    // the status one) must catch it. findUnique must not even be reached.
    const out = JSON.parse(await executeTool(
      'end_conversation', { summary: 'x' }, 'loc1', false, undefined, 'widget', undefined,
      widgetAdapter('conv_1'), undefined, undefined,
      { captured: { contactId: 'c1', reason: 'wants a human', contextSummary: '' } } as any,
      'ws1',
    ))
    expect(out.error).toMatch(/handed it to a human|do not close/i)
    expect(update).not.toHaveBeenCalled()
    expect(findUnique).not.toHaveBeenCalled()
  })
})
