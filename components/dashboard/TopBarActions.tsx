'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import * as Lucide from 'lucide-react'
import { SegmentedControl } from '@/components/ui/primitives'
import { fetchHeartbeat, type HeartbeatPayload } from '@/lib/heartbeat-client'
import { useBackgroundPolling } from '@/lib/use-background-polling'
import { workspaceRest } from '@/lib/dashboard-nav'
import {
  RANGE_LABELS, RANGE_OPTIONS, bellSummary, liveChatCount, parseRange, rangeSupport, type RangeOption,
} from '@/lib/command-palette'

/**
 * Right-hand side of the top bar (handoff TopBar): date range, Live pill,
 * notifications bell. All three read data that already exists:
 *  - range  → `?range=` URL param; the Dashboard's GET /analytics?range= is
 *             the only range-aware source today, so Insights/Activity show the
 *             control disabled.
 *  - Live   → heartbeat `recent` (live-chat conversations from the last ~10 min).
 *  - bell   → heartbeat attention items + pending approvals. There is no
 *             notification-feed endpoint (/notifications only manages delivery
 *             channels), so the bell is a view over the attention queue.
 */
export default function TopBarActions({ workspaceId }: { workspaceId: string }) {
  const pathname = usePathname()
  const rest = workspaceRest(pathname, workspaceId)
  const [hb, setHb] = useState<HeartbeatPayload | null>(null)

  const refresh = useCallback(async () => { setHb(await fetchHeartbeat(workspaceId)) }, [workspaceId])
  useBackgroundPolling(refresh, 30_000, true)

  const support = rangeSupport(rest)

  return (
    <div className="ml-auto flex items-center gap-3">
      {support !== 'hidden' && <RangeControl disabled={support === 'disabled'} />}
      <LivePill count={liveChatCount(hb)} />
      <Bell workspaceId={workspaceId} hb={hb} />
    </div>
  )
}

function RangeControl({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const value = parseRange(sp.get('range'))
  return (
    <>
      {/* TODO(redesign-followup): Insights and Activity APIs take no range — wire `range` through them, then enable. */}
      <SegmentedControl<RangeOption>
        options={RANGE_OPTIONS.map(r => ({ value: r, label: RANGE_LABELS[r] }))}
        value={value}
        disabled={disabled}
        title={disabled ? 'Date range isn’t supported on this page yet' : undefined}
        onChange={v => {
          const next = new URLSearchParams(sp.toString())
          if (v === '7d') next.delete('range'); else next.set('range', v)
          const qs = next.toString()
          router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
        }}
      />
    </>
  )
}

function LivePill({ count }: { count: number }) {
  const on = count > 0
  return (
    <span
      title="Live-chat conversations started in the last ~10 minutes"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 h-7 text-[12px] font-medium ${
        on ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-stone-50 border-stone-200 text-stone-500'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`} />
      Live{on ? ` · ${count}` : ''}
    </span>
  )
}

function Bell({ workspaceId, hb }: { workspaceId: string; hb: HeartbeatPayload | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { items, count } = bellSummary(hb, workspaceId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={count > 0 ? `Notifications, ${count} need attention` : 'Notifications'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="relative h-8 w-8 inline-flex items-center justify-center rounded-md text-text-tertiary hover:bg-surface-secondary hover:text-text-primary cursor-pointer"
      >
        <Lucide.Bell className="w-[18px] h-[18px]" strokeWidth={1.7} />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-brand-500 text-on-brand text-[9.5px] font-semibold flex items-center justify-center tabular-nums">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-10 z-50 w-[340px] xv-card shadow-xl overflow-hidden">
          <div className="h-10 px-4 flex items-center justify-between border-b border-border-theme">
            <span className="text-[13px] font-semibold text-text-primary">Notifications</span>
            <Link href={`/dashboard/${workspaceId}/settings/notifications`} onClick={() => setOpen(false)} className="text-[12px] text-brand-500 font-medium hover:underline">
              Settings
            </Link>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-text-tertiary">You’re all caught up.</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto divide-y divide-border-theme">
              {items.map(it => (
                <li key={it.key}>
                  <Link href={it.href} onClick={() => setOpen(false)} className="block px-4 py-2.5 hover:bg-surface-secondary">
                    <span className="block text-[13px] font-medium text-text-primary truncate">{it.title}</span>
                    {it.detail && <span className="block text-[12px] text-text-tertiary truncate">{it.detail}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/dashboard/${workspaceId}/queue`} onClick={() => setOpen(false)} className="block h-9 leading-9 px-4 border-t border-border-theme text-[12px] font-medium text-brand-500 hover:bg-surface-secondary">
            Open queue →
          </Link>
        </div>
      )}
    </div>
  )
}
