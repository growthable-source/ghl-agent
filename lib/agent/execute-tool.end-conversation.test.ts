import { describe, it, expect, vi, beforeEach } from 'vitest'

// end_conversation must refuse to close a chat that's waiting in the human
// queue (queuedAt set, assignedUserId null). The AI is kept active while a
// visitor waits for a teammate; closing the chat there silently drops them
// from the queue → the "auto-closed without being assigned" bug.

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

  it('closes a chat already assigned to a human even if it was queued', async () => {
    findUnique.mockResolvedValue({ queuedAt: new Date(), assignedUserId: 'u1' })
    const out = JSON.parse(await endConversation())
    expect(out.success).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
  })
})
