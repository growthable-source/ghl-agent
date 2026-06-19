import { describe, it, expect } from 'vitest'
import { connectStreamTwiml, sayHangupTwiml } from './twiml'

describe('connectStreamTwiml', () => {
  it('emits a Connect/Stream with the signed parameter', () => {
    const xml = connectStreamTwiml({ wssUrl: 'wss://bridge.fly.dev/call', signedParams: 'abc.def' })
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Connect><Stream url="wss://bridge.fly.dev/call">' +
        '<Parameter name="p" value="abc.def"/>' +
        '</Stream></Connect></Response>',
    )
  })

  it('escapes XML-special characters in the signed param', () => {
    const xml = connectStreamTwiml({ wssUrl: 'wss://b/call', signedParams: 'a&b"<>' })
    expect(xml).toContain('value="a&amp;b&quot;&lt;&gt;"')
  })
})

describe('sayHangupTwiml', () => {
  it('emits a Say + Hangup', () => {
    const xml = sayHangupTwiml('Sorry, this line is unavailable.')
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Response><Say>Sorry, this line is unavailable.</Say><Hangup/></Response>',
    )
  })
  it('escapes the spoken message', () => {
    expect(sayHangupTwiml('Tom & Jerry')).toContain('<Say>Tom &amp; Jerry</Say>')
  })
})
