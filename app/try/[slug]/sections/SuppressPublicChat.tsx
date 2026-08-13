'use client'

import { useEffect } from 'react'
import {
  markPublicChatSuppressed,
  notifyPublicChatSuppressed,
  setPublicChatSuppressed,
} from '@/lib/leadconnector-chat-suppress'

/**
 * Switches the Xovera LeadConnector sales chat off while a whitelabel
 * lander is on screen, so a partner-branded page never shows — or even
 * loads — a Xovera bubble.
 *
 * WHY A HOOK AND NOT A COMPONENT
 * TryDemoClient returns early while `phase` is still resolving (the
 * one-shot /status probe). A <SuppressPublicChat /> element placed in the
 * main tree therefore does not render on first paint, which is exactly the
 * paint where the root layout's widget effect decides whether to inject
 * its loader. A hook runs before any early return, so the flag is always
 * set in time.
 *
 * WHY THE FLAG IS SET DURING RENDER
 * <LeadConnectorChat /> lives in the root layout as an earlier sibling, so
 * its EFFECT runs before this one. Flipping only in an effect would mean
 * the loader had already been injected and we would merely be hiding a
 * widget that had nonetheless phoned home to leadconnectorhq.com from a
 * page carrying a partner's logo. Every render completes before any effect
 * does, so marking during render lets that effect read `true` and skip the
 * injection entirely.
 *
 * `markPublicChatSuppressed` deliberately does NOT notify subscribers —
 * that mid-render would re-render another component while this one is
 * rendering. The effect publishes it instead.
 */
export function usePublicChatSuppression(enabled: boolean): void {
  if (enabled) markPublicChatSuppressed(true)

  useEffect(() => {
    if (!enabled) return
    // Re-assert on mount: React may have discarded a render (StrictMode, an
    // abandoned transition) after we marked.
    markPublicChatSuppressed(true)
    notifyPublicChatSuppressed()
    return () => setPublicChatSuppressed(false)
  }, [enabled])
}
