'use client'

/**
 * Voice agent — Configuration tab.
 *
 * Re-exports the existing per-agent voice config page from the
 * /agents tree. Single source of truth: any change to the
 * configuration UI propagates to both URLs automatically.
 *
 * Voice agents reach this via the canonical /voice/[agentId]/configuration
 * URL; the /agents/[agentId]/voice URL still renders the same content
 * for back-compat (with the redirect handler eventually moving them
 * here).
 */

export { default } from '../../../agents/[agentId]/voice/page'
