/**
 * CRM Adapter Factory
 * Resolves the correct CRM adapter based on the location's crmProvider.
 */

import { db } from '@/lib/db'
import { GhlAdapter } from './ghl/adapter'
import type { CrmAdapter } from './types'

export async function getCrmAdapter(locationId: string): Promise<CrmAdapter> {
  // Placeholder locations (created when a workspace builds an agent before
  // connecting GHL) short-circuit to the no-op adapter — we don't even
  // hit the DB for them.
  if (locationId.startsWith('placeholder:')) {
    const { NoCrmAdapter } = await import('./none/adapter')
    return new NoCrmAdapter(locationId)
  }

  // Native CRM locations are keyed `native:<workspaceId>`. Same fast path
  // as `placeholder:` — the locationId carries everything the adapter
  // needs (the workspaceId), so skip the DB hop.
  if (locationId.startsWith('native:')) {
    const { NativeAdapter } = await import('./native/adapter')
    return new NativeAdapter(locationId)
  }

  let provider = 'ghl'
  try {
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { crmProvider: true },
    })
    provider = location?.crmProvider ?? 'ghl'
  } catch {
    // crmProvider column may not exist yet — default to ghl
    provider = 'ghl'
  }

  switch (provider) {
    case 'none': {
      const { NoCrmAdapter } = await import('./none/adapter')
      return new NoCrmAdapter(locationId)
    }
    case 'native': {
      const { NativeAdapter } = await import('./native/adapter')
      return new NativeAdapter(locationId)
    }
    case 'hubspot': {
      const { HubSpotAdapter } = await import('./hubspot/adapter')
      return new HubSpotAdapter(locationId)
    }
    default:
      return new GhlAdapter(locationId)
  }
}

/** Synchronous factory when you already know the provider — avoids DB query */
export function createCrmAdapter(locationId: string, provider: string = 'ghl'): CrmAdapter {
  switch (provider) {
    case 'hubspot':
    case 'native': {
      // Dynamic import is async; non-GHL providers must go through
      // getCrmAdapter(). This sync path only works for GHL — kept for
      // backward compat with callers that haven't been migrated yet.
      throw new Error(`Use getCrmAdapter() for ${provider} — createCrmAdapter is sync-only (GHL)`)
    }
    default:
      return new GhlAdapter(locationId)
  }
}
