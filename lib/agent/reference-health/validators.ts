/**
 * Reference validator registry. Each validator knows how to check whether
 * a specific kind of CRM-referenced resource still exists, plus which agent
 * tools depend on that resource type.
 *
 * Add a new resource type here and the rest of the framework — collector,
 * checker, runtime tool-disable, UI — picks it up without code changes
 * elsewhere.
 */

import type { CrmAdapter } from '@/lib/crm/types'

export interface Validator {
  /**
   * Returns null if the resource is healthy.
   * Returns a string (error message) if the resource is broken (404 / gone).
   * Throws if the check itself failed transiently (5xx, network). Callers
   * treat throws as 'transient_error' and preserve the previous status.
   */
  fetch: (adapter: CrmAdapter, id: string) => Promise<null | string>
  /** Human-friendly label shown in the UI and email body ("Calendar", "Workflow"). */
  label: string
  /**
   * Tools that should be hidden from the agent runtime when ANY reference
   * of this type on the agent is broken. The model literally doesn't see
   * these tools in its tool list.
   */
  dependentTools: string[]
}

export const VALIDATORS: Record<string, Validator> = {
  calendar: {
    label: 'Calendar',
    fetch: async (adapter, id) => {
      try {
        await adapter.getCalendar(id)
        return null
      } catch (err: any) {
        const msg = err?.message ?? ''
        if (/\b404\b|not\s*found/i.test(msg)) return msg
        // Anything else — auth, network, 5xx — is transient. Propagate so
        // the caller marks the check as transient_error rather than broken.
        throw err
      }
    },
    dependentTools: [
      'get_available_slots',
      'book_appointment',
      'cancel_appointment',
      'reschedule_appointment',
      'get_calendar_events',
    ],
  },
  workflow: {
    label: 'Workflow',
    fetch: async (adapter, id) => {
      // GHL doesn't expose a single-workflow GET; list and find. Cheap
      // enough — adapters can cache the list per call.
      const ghl = adapter as any
      if (typeof ghl.listWorkflows !== 'function') {
        // Non-GHL adapters can't validate workflows yet — treat as healthy
        // so we don't false-alarm on other CRMs.
        return null
      }
      const workflows = await ghl.listWorkflows()
      if (!Array.isArray(workflows) || !workflows.some((w: any) => w.id === id)) {
        return `workflow ${id} not found`
      }
      return null
    },
    dependentTools: ['add_to_workflow', 'remove_from_workflow'],
  },
}

export function getValidator(resourceType: string): Validator | null {
  return VALIDATORS[resourceType] ?? null
}
