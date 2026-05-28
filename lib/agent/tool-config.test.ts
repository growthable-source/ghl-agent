import { describe, it, expect, vi } from 'vitest'
import { mergeToolConfig, type ResolvedToolConfig } from './tool-config'

describe('mergeToolConfig', () => {
  it('returns catalog defaults when no row exists', () => {
    const result = mergeToolConfig({
      toolName: 'book_appointment',
      row: null,
      catalogDefault: {
        useWhen: 'Use only after slots are picked',
        onFailure: 'default',
      },
    })
    expect(result.enabled).toBe(true)
    expect(result.useWhen).toBe('Use only after slots are picked')
    expect(result.onFailure).toBe('default')
    expect(result.onFailureMessage).toBeNull()
  })

  it('uses row.useWhen when set, falling back to catalog when empty', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: true, useWhen: 'custom rule', onFailure: 'default', onFailureMessage: null },
        catalogDefault: { useWhen: 'catalog rule', onFailure: 'default' },
      }).useWhen,
    ).toBe('custom rule')
  })

  it('treats empty-string useWhen as null (fall back to catalog)', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: true, useWhen: '', onFailure: 'default', onFailureMessage: null },
        catalogDefault: { useWhen: 'catalog rule', onFailure: 'default' },
      }).useWhen,
    ).toBe('catalog rule')
  })

  it('respects explicit enabled=false even when catalog default is enabled', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: false, useWhen: null, onFailure: 'default', onFailureMessage: null },
        catalogDefault: { useWhen: 'catalog', onFailure: 'default' },
      }).enabled,
    ).toBe(false)
  })

  it('uses row.onFailure when set, catalog default otherwise', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: { enabled: true, useWhen: null, onFailure: 'transfer_to_human', onFailureMessage: null },
        catalogDefault: { useWhen: 'c', onFailure: 'default' },
      }).onFailure,
    ).toBe('transfer_to_human')
  })

  it('preserves onFailureMessage when onFailure is canned_message', () => {
    const r = mergeToolConfig({
      toolName: 'x',
      row: { enabled: true, useWhen: null, onFailure: 'canned_message', onFailureMessage: 'Call us at 555' },
      catalogDefault: { useWhen: 'c', onFailure: 'default' },
    })
    expect(r.onFailure).toBe('canned_message')
    expect(r.onFailureMessage).toBe('Call us at 555')
  })

  it('falls back to "default" onFailure when neither row nor catalog specifies', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: null,
        catalogDefault: { useWhen: 'c' },
      }).onFailure,
    ).toBe('default')
  })

  it('returns empty useWhen string when neither row nor catalog provides one', () => {
    expect(
      mergeToolConfig({
        toolName: 'x',
        row: null,
        catalogDefault: {},
      }).useWhen,
    ).toBe('')
  })
})
