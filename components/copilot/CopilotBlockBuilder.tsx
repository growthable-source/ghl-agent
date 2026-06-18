'use client'

/**
 * Advanced-mode block builder for Co-Pilot agents.
 *
 * Controlled editor: renders an ordered list of conversational building
 * blocks (instruction + "wait for reply" + IF→THEN rules) and calls
 * onChange with the new array on every edit. Shared by the new-agent and
 * edit pages so both stay identical. Block ids are assigned client-side so
 * jump rules can reference targets stably before the first save.
 */

import type { CopilotBlock, BlockRule, BlockThenAction } from '@/lib/copilot/blocks'

const uid = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.floor(Math.random() * 1e6)}`

const newBlock = (): CopilotBlock => ({ id: uid(), label: '', instruction: '', waitForResponse: true, rules: [] })
const newRule = (): BlockRule => ({ id: uid(), when: '', then: { action: 'jump' } })

const inputCls = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none'

export default function CopilotBlockBuilder({
  blocks,
  onChange,
}: {
  blocks: CopilotBlock[]
  onChange: (blocks: CopilotBlock[]) => void
}) {
  function patch(i: number, p: Partial<CopilotBlock>) {
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...p } : b)))
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  function patchRule(i: number, ri: number, p: Partial<BlockRule>) {
    patch(i, { rules: blocks[i].rules.map((r, rj) => (rj === ri ? { ...r, ...p } : r)) })
  }
  function patchThen(i: number, ri: number, action: BlockThenAction) {
    patch(i, { rules: blocks[i].rules.map((r, rj) => (rj === ri ? { ...r, then: { action } } : r)) })
  }

  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <div key={b.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-zinc-500">Block {i + 1}</span>
            <div className="flex gap-2 text-xs text-zinc-500">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} className="disabled:opacity-30">↓</button>
              <button type="button" onClick={() => onChange(blocks.filter((_, idx) => idx !== i))} className="text-red-400">Remove</button>
            </div>
          </div>

          <input
            value={b.label}
            onChange={e => patch(i, { label: e.target.value })}
            placeholder="Block name (e.g. Share screen) — used as a jump target"
            className={`${inputCls} mb-2`}
          />
          <textarea
            value={b.instruction}
            onChange={e => patch(i, { instruction: e.target.value })}
            placeholder="What the agent says or does here (e.g. Ask if they can share their screen)"
            rows={2}
            className={`${inputCls} resize-none mb-2`}
          />
          <label className="flex items-center gap-2 text-xs text-zinc-400 mb-3 cursor-pointer">
            <input type="checkbox" checked={b.waitForResponse} onChange={e => patch(i, { waitForResponse: e.target.checked })} />
            Wait for the user&rsquo;s reply before continuing
          </label>

          {/* Rules */}
          <div className="space-y-1.5 pl-1 border-l-2 border-zinc-800">
            {b.rules.map((r, ri) => (
              <div key={r.id} className="flex flex-wrap items-center gap-1.5 pl-2.5 text-xs">
                <span className="text-zinc-500">IF</span>
                <input
                  value={r.when}
                  onChange={e => patchRule(i, ri, { when: e.target.value })}
                  placeholder="the user cannot share their screen"
                  className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 placeholder-zinc-600 focus:outline-none"
                />
                <span className="text-zinc-500">→</span>
                <select
                  value={r.then.action}
                  onChange={e => patchThen(i, ri, e.target.value as BlockThenAction)}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 focus:outline-none"
                >
                  <option value="jump">jump to block</option>
                  <option value="instruct">do this, then continue</option>
                  <option value="end">end / hand off</option>
                </select>
                {r.then.action === 'jump' && (
                  <select
                    value={r.then.targetId ?? ''}
                    onChange={e => patchRule(i, ri, { then: { action: 'jump', targetId: e.target.value } })}
                    className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 focus:outline-none"
                  >
                    <option value="">choose block…</option>
                    {blocks.filter((_, bj) => bj !== i).map(t => (
                      <option key={t.id} value={t.id}>{t.label.trim() || `Block ${blocks.indexOf(t) + 1}`}</option>
                    ))}
                  </select>
                )}
                {r.then.action === 'instruct' && (
                  <input
                    value={r.then.instruction ?? ''}
                    onChange={e => patchRule(i, ri, { then: { action: 'instruct', instruction: e.target.value } })}
                    placeholder="e.g. guide them by voice instead"
                    className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 placeholder-zinc-600 focus:outline-none"
                  />
                )}
                <button type="button" onClick={() => patch(i, { rules: b.rules.filter((_, rj) => rj !== ri) })} className="text-red-400">×</button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => patch(i, { rules: [...b.rules, newRule()] })}
              className="ml-2.5 text-xs"
              style={{ color: 'var(--accent-primary)' }}
            >
              + Add rule
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...blocks, newBlock()])}
        className="w-full rounded-xl border border-dashed border-zinc-700 py-3 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
      >
        + Add block
      </button>
    </div>
  )
}
