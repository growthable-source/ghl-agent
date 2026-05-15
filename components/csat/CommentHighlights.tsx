'use client'

/**
 * Two side-by-side cards: "Needs review" (lowest-rated chats with a
 * comment) and "Bright spots" (top-rated with a comment). Each row
 * is a link straight to the conversation in the inbox.
 */

import Link from 'next/link'
import type { CsatResponse, CsatCommentHighlight } from '@/lib/csat-types'

interface Props {
  highlights: CsatResponse['commentHighlights']
  workspaceId: string
}

export default function CommentHighlights({ highlights, workspaceId }: Props) {
  const { needsReview, brightSpots } = highlights
  if (needsReview.length === 0 && brightSpots.length === 0) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {needsReview.length > 0 && (
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--accent-red)', background: 'var(--surface)' }}>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: 'var(--accent-red)' }}>
            ⚠️ Needs review
          </h2>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>Lowest-rated chats with feedback.</p>
          <div className="space-y-3">
            {needsReview.map(h => (
              <CommentRow key={h.conversationId} workspaceId={workspaceId} highlight={h} />
            ))}
          </div>
        </div>
      )}
      {brightSpots.length > 0 && (
        <div className="rounded-xl border p-5" style={{ borderColor: 'var(--accent-green, #22c55e)', background: 'var(--surface)' }}>
          <h2 className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: 'var(--accent-green, #22c55e)' }}>
            ✨ Bright spots
          </h2>
          <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>Top-rated chats with feedback. Pull-quotes live here.</p>
          <div className="space-y-3">
            {brightSpots.map(h => (
              <CommentRow key={h.conversationId} workspaceId={workspaceId} highlight={h} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CommentRow({ workspaceId, highlight }: { workspaceId: string; highlight: CsatCommentHighlight }) {
  const bg = highlight.rating >= 4 ? 'var(--accent-green-bg, rgba(34,197,94,0.15))'
    : highlight.rating === 3 ? 'var(--accent-amber-bg)'
    : 'var(--accent-red-bg)'
  const fg = highlight.rating >= 4 ? 'var(--accent-green, #22c55e)'
    : highlight.rating === 3 ? 'var(--accent-amber)'
    : 'var(--accent-red)'
  return (
    <Link
      href={`/dashboard/${workspaceId}/inbox?conversation=${highlight.conversationId}`}
      className="block p-3 rounded-lg hover:opacity-80 transition-opacity"
      style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold tabular-nums shrink-0 px-2 py-0.5 rounded" style={{ background: bg, color: fg }}>
          {highlight.rating}★
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm italic line-clamp-3" style={{ color: 'var(--text-primary)' }}>
            &ldquo;{highlight.comment}&rdquo;
          </p>
          <div className="flex items-center gap-2 flex-wrap text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            <span>{highlight.visitorLabel}</span>
            {highlight.brandName && (<><span>·</span><span>{highlight.brandName}</span></>)}
            {highlight.operatorName && (<><span>·</span><span className="text-blue-300">{highlight.operatorName}</span></>)}
            {!highlight.operatorName && highlight.agentName && (<><span>·</span><span className="text-purple-300">{highlight.agentName}</span></>)}
          </div>
        </div>
      </div>
    </Link>
  )
}
