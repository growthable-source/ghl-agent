import { describe, it, expect, afterEach } from 'vitest'
import { buildMeetingRealtimeEndpoints } from './recall'

afterEach(() => {
  delete process.env.RECALL_VIDEO_WORKER_WS_HOST
})

describe('buildMeetingRealtimeEndpoints', () => {
  it('returns [] when no worker host is configured', () => {
    expect(buildMeetingRealtimeEndpoints('tok123')).toEqual([])
  })
  it('builds a websocket video endpoint when the host is set', () => {
    process.env.RECALL_VIDEO_WORKER_WS_HOST = 'voxility-recall-worker.fly.dev'
    expect(buildMeetingRealtimeEndpoints('tok123')).toEqual([
      {
        type: 'websocket',
        url: 'wss://voxility-recall-worker.fly.dev/recall/tok123',
        events: ['video_separate_png.data'],
      },
    ])
  })
})
