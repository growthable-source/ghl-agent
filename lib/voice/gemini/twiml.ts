/** Pure TwiML builders for the Gemini voice answer route. */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const HEADER = '<?xml version="1.0" encoding="UTF-8"?>'

/** <Connect><Stream> bidirectional media stream to the Fly bridge. */
export function connectStreamTwiml(opts: { wssUrl: string; signedParams: string }): string {
  return (
    HEADER +
    '<Response><Connect>' +
    `<Stream url="${xmlEscape(opts.wssUrl)}">` +
    `<Parameter name="p" value="${xmlEscape(opts.signedParams)}"/>` +
    '</Stream></Connect></Response>'
  )
}

/** Graceful fallback: speak a brand-neutral line, then hang up. */
export function sayHangupTwiml(message: string): string {
  return HEADER + `<Response><Say>${xmlEscape(message)}</Say><Hangup/></Response>`
}
