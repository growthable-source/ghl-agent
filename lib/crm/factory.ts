/**
 * CRM Adapter Factory
 * Resolves the correct CRM adapter based on the location's crmProvider.
 */

import { db } from '@/lib/db'
import { GhlAdapter } from './ghl/adapter'
import type { CrmAdapter } from './types'

export async function getCrmAdapter(locationId: string): Promise<CrmAdapter> {
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
    case 'hubspot': {
      // Dynamic import is async, so for HubSpot use getCrmAdapter() instead.
      // This sync path only works for GHL — kept for backward compat.
      throw new Error('Use getCrmAdapter() for HubSpot — createCrmAdapter is sync-only (GHL)')
    }
    default:
      return new GhlAdapter(locationId)
  }
}
