/**
 * Rough visitor queue wait estimate, in seconds. Pure + unit-tested.
 *
 * `position` is 1-based (1 = next to be served). With a workspace-total
 * cap of `maxConcurrent` live human chats and an average handle time,
 * roughly ceil(position / maxConcurrent) handle-cycles must clear before
 * this visitor is picked up. Deliberately conservative — the UI labels
 * it "estimated", never a promise.
 */
export function estimateWaitSecs(position: number, maxConcurrent: number, avgHandleSecs: number): number {
  if (position <= 0 || avgHandleSecs <= 0) return 0
  const cap = Math.max(1, Math.floor(maxConcurrent) || 1)
  const cycles = Math.ceil(position / cap)
  return Math.max(0, Math.round(cycles * avgHandleSecs))
}
