import { describe, expect, it } from 'vitest'
import { DEFAULT_POWERED_BY, widgetPoweredByLine } from './widget-powered-by'

describe('widgetPoweredByLine', () => {
  it('free or unknown plans always show the default', () => {
    expect(widgetPoweredByLine('free', 'Acme')).toBe(DEFAULT_POWERED_BY)
    expect(widgetPoweredByLine(null, '')).toBe(DEFAULT_POWERED_BY)
  })
  it('paid plans can customise or remove it', () => {
    expect(widgetPoweredByLine('growth', 'Acme Support')).toBe('Acme Support')
    expect(widgetPoweredByLine('growth', '')).toBe('')
    expect(widgetPoweredByLine('growth', null)).toBe(DEFAULT_POWERED_BY)
  })
})
