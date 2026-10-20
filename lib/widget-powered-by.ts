/**
 * Visitor-facing "Powered by" footer line for a widget surface (chat
 * embed, call page, hosted call page). One rule everywhere:
 *
 *   - free plans (or unknown plan) → the default line, always
 *   - paid plans → ChatWidget.poweredByText when set; '' hides the line
 *     entirely; null keeps the default
 *
 * The hosted call page used to hard-code "Powered by Xovera", leaking
 * our brand past a paid workspace's custom text or removal.
 */

import { canCustomizeBranding } from '@/lib/plans'

export const DEFAULT_POWERED_BY = 'Powered by Growthable'

export function widgetPoweredByLine(plan: string | null | undefined, custom: string | null | undefined): string {
  if (!plan || !canCustomizeBranding(plan)) return DEFAULT_POWERED_BY
  return custom === null || custom === undefined ? DEFAULT_POWERED_BY : String(custom)
}
