import { describe, it, expect } from 'vitest'
import { RoomRegistry, type Sink } from '../src/rooms.js'

function fakeSink() {
  const sent: string[] = []
  return { sink: { send: (d: string) => sent.push(d) } as Sink, sent }
}
const frame = (type: string, buffer = 'AAAA') =>
  JSON.stringify({
    event: 'video_separate_png.data',
    data: { data: { buffer, type, timestamp: { relative: 1 } }, participant: { id: 7 } },
  })

describe('RoomRegistry', () => {
  it('forwards a screenshare frame from recall to the agent', () => {
    const reg = new RoomRegistry()
    const agent = fakeSink()
    reg.attachAgent('tok', agent.sink)
    reg.attachRecall('tok', fakeSink().sink)
    expect(reg.handleRecallMessage('tok', frame('screenshare'))).toBe(true)
    expect(JSON.parse(agent.sent[0])).toMatchObject({ type: 'frame', mime: 'image/png', data: 'AAAA' })
  })
  it('drops webcam frames', () => {
    const reg = new RoomRegistry()
    const agent = fakeSink()
    reg.attachAgent('tok', agent.sink)
    expect(reg.handleRecallMessage('tok', frame('webcam'))).toBe(false)
    expect(agent.sent).toHaveLength(0)
  })
  it('dedupes identical consecutive frames', () => {
    const reg = new RoomRegistry()
    const agent = fakeSink()
    reg.attachAgent('tok', agent.sink)
    reg.handleRecallMessage('tok', frame('screenshare', 'X'))
    reg.handleRecallMessage('tok', frame('screenshare', 'X'))
    reg.handleRecallMessage('tok', frame('screenshare', 'Y'))
    expect(agent.sent).toHaveLength(2)
  })
  it('does not throw when no agent socket is attached', () => {
    const reg = new RoomRegistry()
    expect(reg.handleRecallMessage('tok', frame('screenshare'))).toBe(false)
  })
  it('drops the room once both sides detach', () => {
    const reg = new RoomRegistry()
    reg.attachAgent('tok', fakeSink().sink)
    reg.attachRecall('tok', fakeSink().sink)
    reg.detachAgent('tok')
    reg.detachRecall('tok')
    expect(reg.roomCount()).toBe(0)
  })
})
