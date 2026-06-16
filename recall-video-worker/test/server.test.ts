import { describe, it, expect } from 'vitest'
import { WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'
import { createWorker } from '../src/server.js'

const once = (ws: WebSocket, ev: string) => new Promise<any>(res => ws.once(ev, res))

describe('worker server', () => {
  it('relays a screenshare frame from /recall to /agent', async () => {
    const { server } = createWorker()
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port

    const agent = new WebSocket(`ws://localhost:${port}/agent/tok1234567890abcd`)
    await once(agent, 'open')
    const recall = new WebSocket(`ws://localhost:${port}/recall/tok1234567890abcd`)
    await once(recall, 'open')

    const got = once(agent, 'message')
    recall.send(
      JSON.stringify({
        event: 'video_separate_png.data',
        data: { data: { buffer: 'ZZZ', type: 'screenshare', timestamp: { relative: 2 } }, participant: { id: 1 } },
      }),
    )
    const msg = await got
    expect(JSON.parse(msg.toString())).toMatchObject({ type: 'frame', mime: 'image/png', data: 'ZZZ' })

    agent.close()
    recall.close()
    await new Promise<void>(r => server.close(() => r()))
  })

  it('rejects an unknown path', async () => {
    const { server } = createWorker()
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as AddressInfo).port
    const bad = new WebSocket(`ws://localhost:${port}/nope`)
    const errored = await once(bad, 'error')
      .then(() => true)
      .catch(() => true)
    expect(errored).toBe(true)
    await new Promise<void>(r => server.close(() => r()))
  })
})
