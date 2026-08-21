/**
 * Reply diff — before/after of an approval-queue reply the reviewer edited.
 *
 * Pure and dependency-free so it unit-tests in the lib harness. Produces a
 * compact git-style line diff for the ticket activity note and the author's
 * "approved with changes" feedback. Line-level (not word-level): a reworded
 * line shows as one removal + one addition, which reads cleanly for the short
 * paragraphs a support reply contains.
 */

export interface ReplyDiff {
  /** True when the texts differ ignoring only leading/trailing whitespace. */
  changed: boolean
  /** Git-style unified body: '  ' context, '- ' removed, '+ ' added. Empty
   *  string when unchanged. */
  unified: string
  addedLines: number
  removedLines: number
}

type Op = { type: 'ctx' | 'add' | 'del'; line: string }

export function computeReplyDiff(original: string, edited: string): ReplyDiff {
  if (original.trim() === edited.trim()) {
    return { changed: false, unified: '', addedLines: 0, removedLines: 0 }
  }

  const a = splitLines(original)
  const b = splitLines(edited)
  const ops = diffLines(a, b)

  let addedLines = 0
  let removedLines = 0
  const rendered = ops.map(op => {
    if (op.type === 'add') { addedLines++; return `+ ${op.line}` }
    if (op.type === 'del') { removedLines++; return `- ${op.line}` }
    return `  ${op.line}`
  })

  return { changed: true, unified: rendered.join('\n'), addedLines, removedLines }
}

/** '' → no lines (so an empty original is all-added, not a blank removal). */
function splitLines(s: string): string[] {
  return s === '' ? [] : s.split('\n')
}

/**
 * Longest-common-subsequence line diff. Classic DP table + backtrack —
 * O(n·m), fine for support-reply sizes. Ties on the backtrack prefer a
 * deletion before an addition so a reword renders as `- old` then `+ new`.
 */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'ctx', line: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', line: a[i] }); i++ }
    else { out.push({ type: 'add', line: b[j] }); j++ }
  }
  while (i < n) { out.push({ type: 'del', line: a[i] }); i++ }
  while (j < m) { out.push({ type: 'add', line: b[j] }); j++ }
  return out
}
