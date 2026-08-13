import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  markPublicChatSuppressed,
  notifyPublicChatSuppressed,
  setPublicChatSuppressed,
  subscribePublicChatSuppressed,
  getPublicChatSuppressed,
  getPublicChatSuppressedServer,
} from './leadconnector-chat-suppress'

beforeEach(() => {
  setPublicChatSuppressed(false)
})

describe('public chat suppression store', () => {
  it('defaults to not suppressed', () => {
    expect(getPublicChatSuppressed()).toBe(false)
  })

  it('server snapshot is always false, so SSR markup matches', () => {
    markPublicChatSuppressed(true)
    expect(getPublicChatSuppressedServer()).toBe(false)
  })

  it('mark changes the value WITHOUT notifying — it is called during render', () => {
    const listener = vi.fn()
    subscribePublicChatSuppressed(listener)

    markPublicChatSuppressed(true)

    // The whole point: notifying here would re-render another component
    // mid-render, which React warns about.
    expect(listener).not.toHaveBeenCalled()
    // ...but the value is readable immediately, which is what
    // LeadConnectorChat's effect relies on to skip injecting its loader.
    expect(getPublicChatSuppressed()).toBe(true)
  })

  it('notify publishes the marked value to subscribers', () => {
    const listener = vi.fn()
    subscribePublicChatSuppressed(listener)

    markPublicChatSuppressed(true)
    notifyPublicChatSuppressed()

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('set changes and notifies in one step', () => {
    const listener = vi.fn()
    subscribePublicChatSuppressed(listener)

    setPublicChatSuppressed(true)

    expect(getPublicChatSuppressed()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('set is a no-op when the value is unchanged', () => {
    const listener = vi.fn()
    subscribePublicChatSuppressed(listener)

    setPublicChatSuppressed(false)

    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribing stops delivery', () => {
    const listener = vi.fn()
    const unsubscribe = subscribePublicChatSuppressed(listener)

    unsubscribe()
    setPublicChatSuppressed(true)

    expect(listener).not.toHaveBeenCalled()
  })

  it('restores to not-suppressed when a lander unmounts', () => {
    setPublicChatSuppressed(true)
    setPublicChatSuppressed(false)
    expect(getPublicChatSuppressed()).toBe(false)
  })
})
