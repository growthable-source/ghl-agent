import type { db as DbClient } from '@/lib/db'
export type Db = typeof DbClient
export type MetricScope = { workspaceId: string; from: Date; to: Date; brandId?: string }
