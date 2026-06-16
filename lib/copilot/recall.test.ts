import { describe, it, expect, afterEach } from 'vitest'
import { buildMeetingRecordingConfig } from './recall'

afterEach(() => {
  delete process.env.RECALL_VIDEO_WORKER_WS_HOST
})

describe('buildMeetingRecordingConfig', () => {
  it('returns null when no worker host is configured', () => {
    expect(buildMeetingRecordingConfig('tok123')).toBeNull()
  })
  it('enables video_separate_png and the realtime endpoint when the host is set', () => {
    process.env.RECALL_VIDEO_WORKER_WS_HOST = 'voxility-recall-worker.fly.dev'
    expect(buildMeetingRecordingConfig('tok123')).toEqual({
      video_mixed_layout: 'gallery_view_v2',
      video_separate_png: {},
      realtime_endpoints: [
        {
          type: 'websocket',
          url: 'wss://voxility-recall-worker.fly.dev/recall/tok123',
          events: ['video_separate_png.data'],
        },
      ],
    })
  })
})
