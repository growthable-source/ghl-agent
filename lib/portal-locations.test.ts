import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('@/lib/db', () => ({ db: {} }))

import { portalConnectionWhere } from './portal-locations'

describe('portalConnectionWhere', () => {
  it('scopes connections to widgets on the portal user’s own brands', () => {
    expect(portalConnectionWhere(['brand_a', 'brand_b'])).toEqual({
      widget: { brandId: { in: ['brand_a', 'brand_b'] } },
    })
  })

  it('returns null (no query) when the user has no brands', () => {
    expect(portalConnectionWhere([])).toBeNull()
  })

  it('never scopes by workspace', () => {
    // A workspace holds many agencies' brands; scoping by it leaked every
    // agency's locations to every other agency (2026-11-04).
    const where = portalConnectionWhere(['brand_a'])
    expect(JSON.stringify(where)).not.toMatch(/workspace/i)
    const src = readFileSync(join(__dirname, 'portal-locations.ts'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/workspaceId/)
  })
})
