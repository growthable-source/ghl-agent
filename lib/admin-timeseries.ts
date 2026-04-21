/**
 * Bucket a set of timestamps into daily counts over a sliding window.
 *
 * We do this in JS rather than SQL so callers only need to pass a
 * single simple query (`SELECT createdAt WHERE createdAt > cutoff`)
 * and we can reuse the bucketing for any entity. At the volumes this
 * is used for (tens of thousands of rows max), memory is fine.
 *
 * `days` = how many daily buckets to produce, ending today inclusive.
 * Missing days are returned as zero, so the chart always has the
 * same number of bars — useful for visually spotting a cron outage.
 */
export function bucketByDay(timestamps: Date[], days: number): Array<{ label: string; value: number }> {
  // Start at today 00:00 UTC and step back (days - 1) times.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const buckets: Array<{ label: string; value: number; start: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000)
    buckets.push({
      label: d.toISOString().slice(5, 10),    // MM-DD, compact for the chart axis
      value: 0,
      start: d.getTime(),
    })
  }
  const totalStart = buckets[0].start
  for (const t of timestamps) {
    const ms = t.getTime()
    if (ms < totalStart) continue
    const idx = Math.floor((ms - totalStart) / 86_400_000)
    if (idx >= 0 && idx < buckets.length) buckets[idx].value++
  }
  // Strip the internal `start` field — callers just want label + value.
  return buckets.map(b => ({ label: b.label, value: b.value }))
}
