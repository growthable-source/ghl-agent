/**
 * Thin wrapper around the SystemSetting key/value table. Keeps schema
 * thin and lets the admin UI evolve without a migration each time.
 *
 * Convention: values are JSON. For a number, wrap as `{ n: 90 }`; for
 * a scalar, stringify — whatever's cheapest to read back. Current
 * keys:
 *
 *   auditRetentionDays   → `{ days: 90 }` or absent (keep forever)
 */

import { db } from './db'

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key } })
    return (row?.value ?? null) as T | null
  } catch (err: any) {
    // Table missing in dev? Treat as "no settings yet".
    if (err.code === 'P2021') return null
    throw err
  }
}

export async function setSetting(
  key: string,
  value: unknown,
  adminEmail: string,
): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    create: { key, value: value as any, updatedBy: adminEmail },
    update: { value: value as any, updatedBy: adminEmail },
  })
}

// Convenience wrappers — typed readers for the keys the admin UI owns.
export async function getAuditRetentionDays(): Promise<number | null> {
  const v = await getSetting<{ days?: unknown }>('auditRetentionDays')
  if (!v || typeof v.days !== 'number' || v.days <= 0) return null
  return Math.floor(v.days)
}
