import { describe, it, expect } from 'vitest'
import { buildTenancyFilter, normaliseGlobalIds } from './retrieve'

/**
 * The shared canonical corpus widens retrieval's tenancy predicate, so
 * these are the tests that stand between one customer's agent and
 * another customer's chunks. Treat a failure here as a leak, not a
 * regression.
 *
 * The invariant: a chunk outside the agent's workspace is reachable
 * ONLY when its collection is explicitly attached to that agent AND the
 * SQL re-confirms kc."isGlobal" = TRUE.
 */

/** Flatten a Prisma.Sql fragment to comparable text. */
function sqlText(frag: { strings: readonly string[] }): string {
  return frag.strings.join('?').replace(/\s+/g, ' ').trim()
}

describe('normaliseGlobalIds', () => {
  it('drops everything when not collection-scoped', () => {
    // knowledgeDomainIds callers (Copilot, /try demos, the eval runner)
    // and workspace-wide callers must keep byte-identical SQL.
    expect(normaliseGlobalIds({
      globalCollectionIds: ['col_global'],
      collectionIds: ['col_global'],
    })).toEqual([])
  })

  it('drops a global id that is not actually attached to the agent', () => {
    // This intersection is what bounds the blast radius. Without it, a
    // caller could name any global collection and read it.
    expect(normaliseGlobalIds({
      scopeToCollections: true,
      collectionIds: ['col_mine'],
      globalCollectionIds: ['col_someone_elses'],
    })).toEqual([])
  })

  it('keeps a global id that is attached', () => {
    expect(normaliseGlobalIds({
      scopeToCollections: true,
      collectionIds: ['col_mine', 'col_corpus'],
      globalCollectionIds: ['col_corpus'],
    })).toEqual(['col_corpus'])
  })

  it('is empty when the caller supplies no global ids', () => {
    expect(normaliseGlobalIds({
      scopeToCollections: true,
      collectionIds: ['col_mine'],
    })).toEqual([])
  })
})

describe('buildTenancyFilter', () => {
  it('emits the original single predicate when there are no globals', () => {
    // Existing traffic must keep an identical query plan.
    const frag = buildTenancyFilter('ws_1', [])
    expect(sqlText(frag)).toBe('d."workspaceId" = ?')
    expect(frag.values).toEqual(['ws_1'])
  })

  it('guards the widened arm with BOTH the id list and isGlobal', () => {
    const text = sqlText(buildTenancyFilter('ws_1', ['col_corpus']))
    expect(text).toContain('d."workspaceId" = ?')
    expect(text).toContain('s."collectionId" = ANY(?::text[])')
    // The DB is the enforcement point — a TS bug upstream still can't
    // cross a tenancy boundary without this check.
    expect(text).toContain('AND kc."isGlobal" = TRUE')
  })

  it('binds the workspace and the global ids as parameters', () => {
    const frag = buildTenancyFilter('ws_1', ['col_corpus'])
    expect(frag.values).toEqual(['ws_1', ['col_corpus']])
  })
})
