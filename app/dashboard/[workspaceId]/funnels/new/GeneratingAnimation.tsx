'use client'

/**
 * GeneratingAnimation — shown while the AI is composing the landing page.
 *
 * Three layered pieces of feedback so the user knows something is happening
 * even though the call takes 20–60s:
 *   1. A pulsing accent-colored ring animation.
 *   2. A rotating status line that walks through the structural sections
 *      the model is producing ("Drafting the hook…", "Stacking proof…").
 *   3. A rotating quote about direct-response copywriting underneath, so
 *      the wait feels intentional rather than empty.
 *
 * Pure presentational — no fetch logic, no progress polling. The parent
 * component flips this off when the generated spec arrives.
 */

import { useEffect, useState } from 'react'

const STATUS_LINES = [
  'Reading the offer…',
  'Drafting the hook…',
  'Naming the false belief…',
  'Revealing the mechanism…',
  'Stacking the proof…',
  'Composing the offer…',
  'Writing the guarantee…',
  'Tightening the headlines…',
  'Pruning AI tells…',
  'Almost done…',
]

const QUOTES = [
  { text: 'The headline is a ticket on the meat.', author: 'David Ogilvy' },
  { text: 'Copy is a direct conversation with the consumer.', author: 'Shirley Polykoff' },
  { text: 'When you can\'t turn a corner, just open the box wider.', author: 'Eugene Schwartz' },
  { text: 'Tell the truth, but make the truth fascinating.', author: 'Bill Bernbach' },
  { text: 'The more informative your advertising, the more persuasive it will be.', author: 'David Ogilvy' },
  { text: 'Make the product the hero of the advertising.', author: 'Bill Bernbach' },
  { text: 'You can\'t bore people into buying your product.', author: 'David Ogilvy' },
  { text: 'A great ad campaign will make a bad product fail faster.', author: 'Bill Bernbach' },
  { text: 'The best ideas come as jokes. Make your thinking as funny as possible.', author: 'David Ogilvy' },
  { text: 'Copy is not written. It is assembled.', author: 'Eugene Schwartz' },
]

export function GeneratingAnimation() {
  const [statusIdx, setStatusIdx] = useState(0)
  const [quoteIdx, setQuoteIdx] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const statusInterval = setInterval(() => {
      setStatusIdx((i) => (i + 1) % STATUS_LINES.length)
    }, 2400)
    const quoteInterval = setInterval(() => {
      setQuoteIdx((i) => (i + 1) % QUOTES.length)
    }, 7000)
    const elapsedInterval = setInterval(() => {
      setElapsed((s) => s + 1)
    }, 1000)
    return () => {
      clearInterval(statusInterval)
      clearInterval(quoteInterval)
      clearInterval(elapsedInterval)
    }
  }, [])

  return (
    <div className="flex flex-col items-center justify-center px-6 py-16">
      {/* Pulsing concentric rings */}
      <div className="relative h-24 w-24">
        <div
          className="absolute inset-0 animate-ping rounded-full opacity-30"
          style={{ background: 'var(--accent-primary)' }}
        />
        <div
          className="absolute inset-2 animate-pulse rounded-full opacity-50"
          style={{ background: 'var(--accent-primary)' }}
        />
        <div
          className="absolute inset-5 rounded-full"
          style={{
            background: 'var(--accent-primary)',
            boxShadow: 'var(--shadow-primary)',
          }}
        />
        <div
          className="absolute inset-7 rounded-full"
          style={{ background: 'var(--surface)' }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg
            className="h-6 w-6 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            style={{ color: 'var(--accent-primary)' }}
          >
            <path strokeLinecap="round" d="M12 3a9 9 0 1 1-6.36 2.64" />
          </svg>
        </div>
      </div>

      {/* Status line — fades between options */}
      <div
        key={statusIdx}
        className="mt-8 text-base font-medium animate-[fadeInOut_2.4s_ease-in-out_infinite]"
        style={{ color: 'var(--text-primary)' }}
      >
        {STATUS_LINES[statusIdx]}
      </div>

      <div className="mt-1 text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
        {elapsed}s — usually 20–60s for a polished page
      </div>

      {/* Quote */}
      <figure
        key={quoteIdx}
        className="mt-12 max-w-md text-center animate-[fadeIn_700ms_ease-out]"
      >
        <blockquote
          className="text-sm italic leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          &ldquo;{QUOTES[quoteIdx].text}&rdquo;
        </blockquote>
        <figcaption
          className="mt-2 text-xs uppercase tracking-wider"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {QUOTES[quoteIdx].author}
        </figcaption>
      </figure>

      {/* Inline keyframes — keeps the animation self-contained without a
          globals.css edit. Tailwind v4 evaluates the arbitrary classes
          above against these. */}
      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInOut {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
