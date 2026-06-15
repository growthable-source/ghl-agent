'use client'

/**
 * Tiny self-contained "play while you wait" game for the chat widget
 * queue — a 4×4 2048. No external deps, no network, keyboard + swipe.
 * Fits inside the narrow widget; rendered only when the visitor is
 * queued and the workspace enabled the game.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Grid = number[][]

const SIZE = 4

function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0))
}

function clone(g: Grid): Grid {
  return g.map(row => [...row])
}

// Deterministic-free spawn: place a 2 (90%) or 4 (10%) on a random empty
// cell. Math.random is fine here — this is a throwaway in-widget game.
function spawn(g: Grid): Grid {
  const empties: Array<[number, number]> = []
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (g[r][c] === 0) empties.push([r, c])
  if (empties.length === 0) return g
  const [r, c] = empties[Math.floor(Math.random() * empties.length)]
  const next = clone(g)
  next[r][c] = Math.random() < 0.9 ? 2 : 4
  return next
}

// Slide + merge one row to the left. Returns [newRow, gained].
function collapseRow(row: number[]): [number[], number] {
  const nums = row.filter(n => n !== 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < nums.length; i++) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      const merged = nums[i] * 2
      out.push(merged)
      gained += merged
      i++
    } else {
      out.push(nums[i])
    }
  }
  while (out.length < SIZE) out.push(0)
  return [out, gained]
}

function transpose(g: Grid): Grid {
  const out = emptyGrid()
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) out[c][r] = g[r][c]
  return out
}

type Dir = 'left' | 'right' | 'up' | 'down'

// Reduce every direction to a left-collapse via reverse/transpose — each
// step is its own exact inverse, so there's no rotation bookkeeping.
function move(g: Grid, dir: Dir): { grid: Grid; gained: number; moved: boolean } {
  let work = g
  if (dir === 'right') work = work.map(row => [...row].reverse())
  else if (dir === 'up') work = transpose(work)
  else if (dir === 'down') work = transpose(work).map(row => [...row].reverse())

  let gained = 0
  let collapsed = work.map(row => {
    const [nr, gn] = collapseRow(row)
    gained += gn
    return nr
  })

  if (dir === 'right') collapsed = collapsed.map(row => [...row].reverse())
  else if (dir === 'up') collapsed = transpose(collapsed)
  else if (dir === 'down') collapsed = transpose(collapsed.map(row => [...row].reverse()))

  const moved = JSON.stringify(collapsed) !== JSON.stringify(g)
  return { grid: collapsed, gained, moved }
}

function hasMoves(g: Grid): boolean {
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    if (g[r][c] === 0) return true
    if (c + 1 < SIZE && g[r][c] === g[r][c + 1]) return true
    if (r + 1 < SIZE && g[r][c] === g[r + 1][c]) return true
  }
  return false
}

const TILE_BG: Record<number, string> = {
  0: 'rgba(255,255,255,0.04)', 2: '#3a3320', 4: '#46391c', 8: '#7a4a1e',
  16: '#8a4a1a', 32: '#9a4418', 64: '#a83a12', 128: '#b6890f',
  256: '#bd910c', 512: '#c79a09', 1024: '#cfa406', 2048: '#d9af00',
}

export default function QueueGame({ accent }: { accent: string }) {
  const [grid, setGrid] = useState<Grid>(() => spawn(spawn(emptyGrid())))
  const [score, setScore] = useState(0)
  const [over, setOver] = useState(false)
  const touchRef = useRef<{ x: number; y: number } | null>(null)

  const doMove = useCallback((dir: Dir) => {
    setGrid(prev => {
      if (!hasMoves(prev)) return prev
      const { grid: moved, gained, moved: didMove } = move(prev, dir)
      if (!didMove) return prev
      if (gained) setScore(s => s + gained)
      const next = spawn(moved)
      if (!hasMoves(next)) setOver(true)
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
      const dir = map[e.key]
      if (dir) { e.preventDefault(); doMove(dir) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doMove])

  function reset() {
    setGrid(spawn(spawn(emptyGrid())))
    setScore(0)
    setOver(false)
  }

  return (
    <div
      className="rounded-lg p-2 select-none"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
      onTouchStart={e => { const t = e.touches[0]; touchRef.current = { x: t.clientX, y: t.clientY } }}
      onTouchEnd={e => {
        const s = touchRef.current
        if (!s) return
        const t = e.changedTouches[0]
        const dx = t.clientX - s.x
        const dy = t.clientY - s.y
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return
        doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
        touchRef.current = null
      }}
    >
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[10px] font-semibold" style={{ color: accent }}>2048 · {score}</span>
        <button type="button" onClick={reset} className="text-[10px] text-zinc-400 hover:text-zinc-200">Reset</button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {grid.flat().map((v, i) => (
          <div
            key={i}
            className="aspect-square rounded flex items-center justify-center text-[12px] font-bold"
            style={{ background: TILE_BG[v] ?? '#d9af00', color: v > 4 ? '#fff' : '#cbb' }}
          >
            {v > 0 ? v : ''}
          </div>
        ))}
      </div>
      {over && (
        <p className="text-[10px] text-center mt-1.5 text-zinc-300">
          Game over · <button type="button" onClick={reset} className="underline" style={{ color: accent }}>play again</button>
        </p>
      )}
      <p className="text-[9px] text-center mt-1 text-zinc-500">Arrow keys or swipe</p>
    </div>
  )
}
