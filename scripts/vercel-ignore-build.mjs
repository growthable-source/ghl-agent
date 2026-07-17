#!/usr/bin/env node
/**
 * Vercel "Ignored Build Step" — decides whether a git push needs a build.
 * Exit 1 = build. Exit 0 = skip (previous deployment stays live untouched).
 *
 * Two Vercel projects deploy this repo:
 *
 *   - voxilityai (dashboard + marketing + everything): always builds.
 *   - xovera-widget (chat-widget runtime, env IS_WIDGET_RUNTIME=1):
 *     builds ONLY when widget-facing code changed. This is the isolation
 *     that keeps dashboard/marketing deploys from ever cutting over the
 *     live chat service — no function churn, no severed SSE streams.
 *
 * The path list below is the widget runtime's dependency surface. If the
 * widget iframe pages (app/widget/**) grow an import from somewhere new
 * outside these prefixes, add the prefix here — otherwise the widget
 * project will serve stale code for that dependency until an unrelated
 * widget deploy picks it up.
 *
 * Escape hatch: a commit message containing [widget-deploy] forces a
 * widget build regardless of paths. Any git error fails open (builds).
 */

import { execSync } from 'node:child_process'

if (process.env.IS_WIDGET_RUNTIME !== '1') {
  process.exit(1) // main project: always build
}

const WIDGET_PATHS = [
  'public/widget.js',
  'app/widget/',
  'app/api/widget/',
  'app/api/health',
  'components/widget/',
  'components/copilot/',
  'components/ChatMarkdown',
  'lib/',
  'prisma/',
  'scripts/',
  'middleware.ts',
  'next.config.ts',
  'vercel.json',
  'package.json',
  'package-lock.json',
]

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

try {
  const message = sh('git log -1 --pretty=%B')
  if (message.includes('[widget-deploy]')) {
    console.log('[ignore-build] [widget-deploy] tag in commit message → build.')
    process.exit(1)
  }

  // Vercel clones with history, so HEAD^ is available except on the very
  // first commit — that case throws and we fail open below. Note this
  // only diffs the tip commit; pushes here are one-commit-per-change, and
  // [widget-deploy] covers the rare batched push.
  const changed = sh('git diff --name-only HEAD^ HEAD').split('\n').filter(Boolean)
  const hits = changed.filter((f) => WIDGET_PATHS.some((p) => f.startsWith(p)))

  if (hits.length > 0) {
    console.log(`[ignore-build] Widget-facing changes → build:\n  ${hits.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`[ignore-build] No widget-facing changes in ${changed.length} changed file(s) → skip. Live widget deployment untouched.`)
  process.exit(0)
} catch (err) {
  console.log(`[ignore-build] Could not diff (${err.message.split('\n')[0]}) → building to be safe.`)
  process.exit(1)
}
