/**
 * Runs once when a server instance starts (Next.js instrumentation hook).
 *
 * Test builds only: add the white-label sign-in schema if the database
 * doesn't have it yet — see lib/whitelabel/ensure-test-schema.ts. A no-op
 * in production and in the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { ensureWhitelabelTestSchema } = await import('@/lib/whitelabel/ensure-test-schema')
  await ensureWhitelabelTestSchema()
}
