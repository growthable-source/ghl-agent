'use client'

/**
 * Renders the live timeline of a Manus-style build — one card per
 * iteration, each showing the rendered screenshot, the vision critic's
 * 0-10 score, and the structured critique. The currently selected
 * iteration is the one that will be published.
 *
 * Used on the funnel-creation wizard's step 3 and on the campaign
 * detail page's "rebuild" surface — same visual language so the
 * operator's mental model is consistent.
 */

import type { ReactNode } from 'react'

export type IssueSeverity = 'minor' | 'major' | 'critical'

export interface CritiqueIssue {
  section: string
  severity: IssueSeverity
  problem: string
  fix_suggestion: string
}

export interface PageCritique {
  score: number
  pass: boolean
  summary: string
  issues: CritiqueIssue[]
  strengths: string[]
}

export type IterationStatus = 'rendering' | 'critiquing' | 'patching' | 'complete' | 'failed'

export interface BuildIteration {
  id: string
  iteration: number
  status: IterationStatus
  screenshotUrl: string | null
  score: number | null
  critique: PageCritique | null
  specSnapshot: { title?: string; meta_description?: string; spec?: object } | null
  error: string | null
  startedAt: string
  completedAt: string | null
}

export type BuildStatus = 'queued' | 'running' | 'passed' | 'capped' | 'failed'

export interface BuildState {
  id: string
  status: BuildStatus
  maxIterations: number
  scoreThreshold: number
  bestScore: number | null
  bestIterationId: string | null
  error: string | null
  startedAt: string
  completedAt: string | null
  iterations: BuildIteration[]
}

export function BuildTimeline(props: {
  build: BuildState
  selectedIterationId: string | null
  onSelect: (id: string) => void
  /** Optional banner above the timeline. */
  banner?: ReactNode
}) {
  const { build, selectedIterationId, onSelect, banner } = props
  const stillPatching =
    build.status === 'running' &&
    build.iterations.length > 0 &&
    build.iterations.every((i) => i.status === 'complete' || i.status === 'failed') &&
    build.iterations.length < build.maxIterations

  return (
    <div className="space-y-3">
      {banner}

      {build.iterations.map((iter) => (
        <IterationCard
          key={iter.id}
          iter={iter}
          isSelected={selectedIterationId === iter.id}
          isBest={build.bestIterationId === iter.id}
          onSelect={() => onSelect(iter.id)}
        />
      ))}

      {stillPatching && (
        <div
          className="rounded-lg p-4 text-center text-xs"
          style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
        >
          Patching for iteration {build.iterations.length + 1}…
        </div>
      )}
    </div>
  )
}

function IterationCard(props: {
  iter: BuildIteration
  isSelected: boolean
  isBest: boolean
  onSelect: () => void
}) {
  const { iter, isSelected, isBest, onSelect } = props
  const hasShot = !!iter.screenshotUrl
  const score = iter.score
  const critique = iter.critique

  const statusLabel =
    iter.status === 'rendering'
      ? 'Rendering page in browser…'
      : iter.status === 'critiquing'
        ? 'Vision critique in progress…'
        : iter.status === 'patching'
          ? 'Applying fixes…'
          : iter.status === 'failed'
            ? 'Failed'
            : null

  const borderColor = isSelected ? 'var(--accent-primary)' : 'var(--border)'

  return (
    <button
      type="button"
      onClick={iter.status === 'complete' ? onSelect : undefined}
      disabled={iter.status !== 'complete'}
      className="w-full rounded-lg p-3 text-left transition-shadow disabled:cursor-default"
      style={{
        background: 'var(--surface)',
        borderWidth: isSelected ? '2px' : '1px',
        borderStyle: 'solid',
        borderColor,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="relative shrink-0 overflow-hidden rounded-md"
          style={{
            width: '160px',
            height: '90px',
            background: 'var(--surface-secondary)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--border)',
          }}
        >
          {hasShot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iter.screenshotUrl!}
              alt={`Iteration ${iter.iteration}`}
              className="block h-full w-full object-cover object-top"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-[10px]"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {iter.status === 'rendering' ? 'Rendering…' : iter.status === 'failed' ? 'Failed' : 'Pending'}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Iteration {iter.iteration}
            </span>
            {typeof score === 'number' && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  background:
                    score >= 8
                      ? 'var(--accent-emerald-bg)'
                      : score >= 6
                        ? 'var(--accent-amber-bg)'
                        : 'var(--accent-red-bg)',
                  color:
                    score >= 8
                      ? 'var(--accent-emerald)'
                      : score >= 6
                        ? 'var(--accent-amber)'
                        : 'var(--accent-red)',
                }}
              >
                {score.toFixed(1)} / 10
              </span>
            )}
            {isBest && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
              >
                Best
              </span>
            )}
            {isSelected && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Selected
              </span>
            )}
          </div>

          {statusLabel && (
            <div className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {statusLabel}
            </div>
          )}

          {critique && (
            <>
              <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
                {critique.summary}
              </p>
              {critique.issues.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {critique.issues.length} {critique.issues.length === 1 ? 'issue' : 'issues'} the next pass tried to fix
                  </summary>
                  <ul className="mt-1.5 space-y-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {critique.issues.map((issue, i) => (
                      <li key={i}>
                        <span
                          className="mr-1.5 inline-block rounded px-1 py-0.5 text-[9px] uppercase tracking-wider"
                          style={{
                            background:
                              issue.severity === 'critical'
                                ? 'var(--accent-red-bg)'
                                : issue.severity === 'major'
                                  ? 'var(--accent-amber-bg)'
                                  : 'var(--surface-secondary)',
                            color:
                              issue.severity === 'critical'
                                ? 'var(--accent-red)'
                                : issue.severity === 'major'
                                  ? 'var(--accent-amber)'
                                  : 'var(--text-tertiary)',
                          }}
                        >
                          {issue.severity}
                        </span>
                        <strong style={{ color: 'var(--text-primary)' }}>{issue.section}:</strong> {issue.problem}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {iter.error && (
            <div className="mt-1 text-xs" style={{ color: 'var(--accent-red)' }}>
              {iter.error}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
