import { db } from './db'

/**
 * Record an auditable action. Swallows errors so audit logging never
 * breaks the underlying operation.
 */
export async function audit(params: {
  workspaceId: string
  actorId: string
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
}) {
  try {
    await db.auditLog.create({
      data: {
        workspaceId: params.workspaceId,
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType ?? null,
        targetId: params.targetId ?? null,
        metadata: params.metadata as any,
      },
    })
  } catch (err: any) {
    // Table may not exist yet — swallow silently
    console.warn('[Audit]', params.action, err.message)
  }
}
