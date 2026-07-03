import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { relTime } from '@/components/inbox/conversation-helpers'
import TelemetryMap, { type GeoPoint } from '@/components/portal/TelemetryMap'
import WordCloud from '@/components/portal/WordCloud'
import TopTopics from '@/components/portal/TopTopics'
import { getOverviewInsights } from '@/lib/portal/overview-insights'
import { getConnectionSummaries, getChatsPerLocation } from '@/lib/portal/subaccount-stats'
import { getSupportLeaderboard } from '@/lib/portal/leaderboard'
import { getPortalAiInsights } from '@/lib/portal/ai-insights'
import { Trophy, Medal, TrendingUp, TrendingDown, Minus, Sparkles, MessageCircle, Ticket } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Operations Overview · Customer Portal',
  robots: { index: false, follow: false },
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default async function PortalOverview() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  if (session.brandIds.length === 0) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold text-white">Operations Overview</h1>
        <p className="text-sm text-zinc-400 mt-2">No brands are assigned to your account yet — metrics will appear here once they are.</p>
      </div>
    )
  }

  const brands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { id: true, workspaceId: true },
  })
  const workspaceIds = Array.from(new Set(brands.map(b => b.workspaceId)))
  const widgets = await db.chatWidget.findMany({
    where: { brandId: { in: session.brandIds } },
    select: { id: true },
  })
  const widgetIds = widgets.map(w => w.id)
  const since30d = new Date(Date.now() - 30 * 86_400_000)
  const base = { widgetId: { in: widgetIds } }

  const [
    activeCount, endedRecent, csatAgg, agentsOnline, agentsTotal,
    heatRows, liveFeed, topAgentGroups, voiceCount, ended30, total30,
  ] = widgetIds.length === 0
    ? [0, [], { _avg: { csatRating: null }, _count: { csatRating: 0 } }, 0, 0, [], [], [], 0, 0, 0]
    : await Promise.all([
        db.widgetConversation.count({ where: { ...base, status: 'active' } }),
        db.widgetConversation.findMany({
          where: { ...base, status: 'ended', assignedAt: { not: null } },
          select: { assignedAt: true, lastMessageAt: true },
          orderBy: { lastMessageAt: 'desc' }, take: 200,
        }),
        db.widgetConversation.aggregate({ where: base, _avg: { csatRating: true }, _count: { csatRating: true } }),
        db.workspaceMember.count({ where: { workspaceId: { in: workspaceIds }, isAvailable: true, role: { not: 'viewer' } } }),
        db.workspaceMember.count({ where: { workspaceId: { in: workspaceIds }, role: { not: 'viewer' } } }),
        db.widgetConversation.findMany({ where: { ...base, createdAt: { gte: since30d } }, select: { createdAt: true }, take: 6000 }),
        db.widgetConversation.findMany({
          where: { ...base, status: 'active' },
          orderBy: { lastMessageAt: 'desc' }, take: 9,
          select: { id: true, lastMessageAt: true, assignedUserId: true, visitor: { select: { name: true, email: true } }, _count: { select: { messages: true } } },
        }),
        db.widgetConversation.groupBy({ by: ['assignedUserId'], where: { ...base, assignedUserId: { not: null } }, _count: { _all: true }, orderBy: { _count: { assignedUserId: 'desc' } }, take: 5 }),
        db.widgetConversation.count({ where: { ...base, voiceCalls: { some: {} } } }),
        db.widgetConversation.count({ where: { ...base, status: 'ended', createdAt: { gte: since30d } } }),
        db.widgetConversation.count({ where: { ...base, createdAt: { gte: since30d } } }),
      ])

  // KPIs
  const avgResSecs = endedRecent.length
    ? endedRecent.reduce((s, c) => s + Math.max(0, (c.lastMessageAt.getTime() - (c.assignedAt as Date).getTime()) / 1000), 0) / endedRecent.length
    : 0
  const csatPct = csatAgg._avg.csatRating ? Math.round((csatAgg._avg.csatRating / 5) * 1000) / 10 : null
  const resolutionRate = total30 > 0 ? Math.round((ended30 / total30) * 100) : 0
  const voicePct = total30 > 0 ? Math.round((voiceCount / Math.max(total30, voiceCount)) * 100) : 0

  // Density heatmap (day × hour)
  const grid = DAYS.map(() => new Array(24).fill(0))
  let maxCell = 1
  for (const r of heatRows) {
    const d = (r.createdAt.getDay() + 6) % 7 // Mon=0
    const h = r.createdAt.getHours()
    grid[d][h]++
    if (grid[d][h] > maxCell) maxCell = grid[d][h]
  }

  // Geo telemetry — visitor locations (Vercel edge geo), aggregated by
  // country with average coordinates. Real data; empty until visitors
  // arrive post-migration.
  let geoPoints: GeoPoint[] = []
  if (widgetIds.length > 0) {
    try {
      const geoRows = await db.widgetConversation.findMany({
        where: { ...base, createdAt: { gte: since30d }, visitor: { is: { country: { not: null }, latitude: { not: null } } } },
        select: { visitor: { select: { country: true, latitude: true, longitude: true } } },
        take: 5000,
      })
      const byCountry = new Map<string, { count: number; lat: number; lng: number }>()
      for (const g of geoRows) {
        const v = g.visitor
        if (!v.country || v.latitude == null || v.longitude == null) continue
        const e = byCountry.get(v.country) ?? { count: 0, lat: 0, lng: 0 }
        e.count++; e.lat += v.latitude; e.lng += v.longitude
        byCountry.set(v.country, e)
      }
      geoPoints = Array.from(byCountry.entries())
        .map(([country, e]) => ({ country, count: e.count, lat: e.lat / e.count, lng: e.lng / e.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40)
    } catch { /* geo columns missing pre-migration — empty map */ }
  }

  // Insight panels — word cloud (what visitors ask about) + top topics
  // (knowledge the AI matched). Both best-effort; see overview-insights.ts.
  const { cloudTerms, topTopics } = await getOverviewInsights({ widgetIds, since: since30d })

  // CRM connection status, per-sub-account chat volume, top support
  // consumers, and the cached AI weekly briefing. All best-effort — each
  // degrades to empty on un-migrated DBs. AI insights render from cache;
  // a stale/missing cache kicks off a background regenerate.
  const [connections, locationChats, leaderboard, aiInsights] = await Promise.all([
    getConnectionSummaries(widgetIds),
    getChatsPerLocation(widgetIds, since30d),
    // 7-day window on purpose: rank movement is week-over-week, matching
    // the email report.
    getSupportLeaderboard(widgetIds, session.brandIds, 7),
    getPortalAiInsights(session.portalId, widgetIds, workspaceIds[0] ?? null),
  ])

  // Top agents → names
  const agentIds = topAgentGroups.map(g => g.assignedUserId).filter(Boolean) as string[]
  const agentUsers = agentIds.length ? await db.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, email: true } }) : []
  const agentName = new Map(agentUsers.map(u => [u.id, u.name ?? u.email ?? 'Agent']))

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Operations Overview</h1>
          <p className="text-sm text-zinc-400 mt-1">Live support metrics across your brands · last 30 days.</p>
        </div>
        <Link href="/portal/conversations" className="px-3.5 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--portal-accent)' }}>
          View all conversations →
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
        <Kpi label="Active Chats" value={activeCount.toLocaleString()} tone="accent" />
        <Kpi label="Avg Resolution" value={avgResSecs ? fmtDuration(avgResSecs) : '—'} />
        <Kpi label="CSAT Score" value={csatPct != null ? `${csatPct}%` : '—'} tone="emerald" sub={`${csatAgg._count.csatRating.toLocaleString()} ratings`} />
        <Kpi label="Agents Online" value={`${agentsOnline}`} sub={`of ${agentsTotal} on the team`} />
      </div>

      {/* AI insights — the weekly briefing synthesized from support themes */}
      <div className="rounded-xl border border-zinc-800 p-4 mt-4" style={{ background: 'var(--surface)' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--portal-accent)' }}>
            ✦ AI Insights
          </p>
          <span className="text-[10px] text-zinc-500">
            {aiInsights
              ? <>last {aiInsights.windowDays} days · updated {aiInsights.generatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{aiInsights.stale ? ' · refreshing…' : ''}</>
              : 'analyzing recent conversations…'}
          </span>
        </div>
        {aiInsights ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {aiInsights.insights.map((ins, i) => (
              <div key={i} className="rounded-lg border border-zinc-800 p-3.5" style={{ background: 'var(--surface-secondary)' }}>
                <p className="text-sm font-semibold text-zinc-100">{ins.headline}</p>
                <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{ins.detail}</p>
                <p className="text-xs mt-2.5">
                  <span className="font-semibold" style={{ color: 'var(--portal-accent)' }}>Suggested: </span>
                  <span className="text-zinc-300">{ins.suggestedAction}</span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500 py-2">
            Insights appear here once your assistant has analyzed a week of conversations —
            what customers keep asking about, what changed, and what to do about it. Check back soon.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        {/* LEFT 2/3: telemetry + heatmap */}
        <div className="lg:col-span-2 space-y-4">
          {/* Global telemetry — real visitor locations (Vercel edge geo) */}
          <Panel title="Global Telemetry" right={<span className="text-[10px] text-zinc-500">by visitor location · 30d</span>}>
            <TelemetryMap points={geoPoints} />
          </Panel>

          {/* Operational density heatmap */}
          <Panel title="Operational Density" right={<span className="text-[10px] text-zinc-500">conversations · day × hour</span>}>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="flex">
                  <div className="w-8" />
                  {HOURS.map(h => (
                    <div key={h} className="flex-1 text-center text-[8px] text-zinc-600">{h % 6 === 0 ? `${h}` : ''}</div>
                  ))}
                </div>
                {grid.map((row, d) => (
                  <div key={d} className="flex items-center">
                    <div className="w-8 text-[9px] text-zinc-500">{DAYS[d]}</div>
                    {row.map((v, h) => (
                      <div key={h} className="flex-1 aspect-square m-[1px] rounded-[2px]" title={`${DAYS[d]} ${h}:00 — ${v}`}
                        style={{ background: v === 0 ? 'var(--surface-tertiary)' : `color-mix(in srgb, var(--portal-accent) ${Math.round((v / maxCell) * 85) + 15}%, transparent)` }} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          {/* Channel + SLA cards */}
          <div className="grid grid-cols-2 gap-4">
            <Panel title="Top Channel">
              <p className="text-xl font-bold text-white">Live Chat</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{voicePct > 0 ? `Voice handles ${voicePct}% of volume` : 'Primary support channel'}</p>
            </Panel>
            <Panel title="Resolution Rate" right={<span className="text-[10px] text-zinc-500">last 30d</span>}>
              <p className="text-xl font-bold" style={{ color: 'var(--accent-emerald)' }}>{resolutionRate}%</p>
              <div className="h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
                <div className="h-full rounded-full" style={{ width: `${resolutionRate}%`, background: 'var(--accent-emerald)' }} />
              </div>
            </Panel>
          </div>
        </div>

        {/* RIGHT 1/3: live feed + top agents */}
        <div className="space-y-4">
          <Panel title="Active Chats" right={<span className="inline-flex items-center gap-1 text-[10px] text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />live</span>}>
            {liveFeed.length === 0 ? (
              <p className="text-xs text-zinc-500 py-4 text-center">No active chats right now.</p>
            ) : (
              <div className="space-y-1 -mx-1">
                {liveFeed.map(c => (
                  <Link key={c.id} href={`/portal/conversations/${c.id}`} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg hover:bg-[var(--surface-secondary)] transition-colors">
                    <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white" style={{ background: 'var(--portal-accent)' }}>
                      {(c.visitor.name || c.visitor.email || 'V').charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-zinc-100 truncate">{c.visitor.name || c.visitor.email || 'Anonymous'}</p>
                      <p className="text-[10px] text-zinc-500">{c._count.messages} msgs · {relTime(c.lastMessageAt.toISOString())}</p>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0" style={c.assignedUserId ? { background: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' } : { background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}>
                      {c.assignedUserId ? 'human' : 'AI'}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Top Agents — now">
            {topAgentGroups.length === 0 ? (
              <p className="text-xs text-zinc-500 py-2">No human-handled chats yet.</p>
            ) : (
              <div className="space-y-2">
                {topAgentGroups.map((g, i) => (
                  <div key={g.assignedUserId} className="flex items-center gap-2.5">
                    <span className="text-[10px] text-zinc-600 w-3">{i + 1}</span>
                    <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: 'var(--accent-blue)' }}>
                      {(agentName.get(g.assignedUserId!) || 'A').charAt(0).toUpperCase()}
                    </span>
                    <span className="text-xs text-zinc-200 flex-1 truncate">{agentName.get(g.assignedUserId!)}</span>
                    <span className="text-xs font-semibold text-zinc-400">{g._count._all}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Word cloud — what visitors are asking about, in their words */}
          <Panel title="What People Ask About" right={<span className="text-[10px] text-zinc-500">visitor questions · 30d</span>}>
            <WordCloud terms={cloudTerms} />
          </Panel>

          {/* Top topics — knowledge the AI matched to answer */}
          <Panel title="Top Topics" right={<span className="text-[10px] text-zinc-500">knowledge used · 30d</span>}>
            <TopTopics topics={topTopics} />
          </Panel>

          {/* CRM connection — which agency each widget is linked to */}
          <Panel title="CRM Connection" right={connections.length > 0 ? <span className="text-[10px]" style={{ color: 'var(--accent-emerald)' }}>● connected</span> : undefined}>
            {connections.length === 0 ? (
              <p className="text-xs text-zinc-500">No CRM agency connected to your widgets yet.</p>
            ) : (
              <div className="space-y-2.5">
                {connections.map(c => (
                  <div key={c.widgetId} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-200 truncate">{c.companyName ?? c.companyId}</p>
                      <p className="text-[10px] text-zinc-500 truncate">via {c.widgetName}</p>
                    </div>
                    <span className="text-[10px] text-zinc-400 shrink-0">
                      {c.enabledLocations}/{c.totalLocations} locations on
                    </span>
                  </div>
                ))}
                <Link href="/portal/locations" className="inline-block text-[11px] hover:underline" style={{ color: 'var(--portal-accent)' }}>
                  Manage locations →
                </Link>
              </div>
            )}
          </Panel>

          {/* Chats by sub-account — forward-only from location capture */}
          <Panel title="Chats by Sub-account" right={<span className="text-[10px] text-zinc-500">30d</span>}>
            {locationChats.rows.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No location-attributed chats yet — counts appear as new conversations come in from your sub-accounts.
              </p>
            ) : (
              <div className="space-y-1.5">
                {locationChats.rows.map((l, i) => (
                  <div key={l.locationId} className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600 w-3">{i + 1}</span>
                    <span className="text-xs text-zinc-200 flex-1 truncate">{l.name ?? l.locationId}</span>
                    <span className="text-xs font-semibold text-zinc-400">{l.count}</span>
                  </div>
                ))}
                {locationChats.unattributed > 0 && (
                  <p className="text-[10px] text-zinc-600 pt-1">
                    +{locationChats.unattributed} chats without location data (older embeds / non-CRM sites)
                  </p>
                )}
              </div>
            )}
          </Panel>

        </div>
      </div>

      {/* ─── Support MVPs — full-width leaderboard ─────────────────────
          Gets real estate on purpose: this is the engagement +
          knowledge-gap map. Tone is celebratory (medals, trends), not
          scolding — heavy use means engaged customers. */}
      <div className="rounded-xl border border-zinc-800 mt-4 overflow-hidden" style={{ background: 'var(--surface)' }}>
        <div className="flex items-center justify-between flex-wrap gap-2 px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <span
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--portal-accent) 15%, transparent)', color: 'var(--portal-accent)' }}
            >
              <Trophy size={16} strokeWidth={2} />
            </span>
            <div>
              <p className="text-sm font-semibold text-zinc-100">Support MVPs</p>
              <p className="text-[11px] text-zinc-500">Most engaged people · last 7 days · movement vs the week before</p>
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">chats + tickets</span>
        </div>

        {leaderboard.length === 0 ? (
          <p className="px-5 pb-5 text-xs text-zinc-500">
            No identified users in the window yet — the board fills as people chat or open tickets.
          </p>
        ) : (
          <div>
            <div className="grid grid-cols-[3rem_1fr_5rem_5rem_6rem_5rem] max-sm:grid-cols-[2.5rem_1fr_5rem_4rem] items-center gap-x-3 border-y border-zinc-800 px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600" style={{ background: 'var(--surface-secondary)' }}>
              <span>Rank</span>
              <span>Person</span>
              <span className="text-right max-sm:hidden">Chats</span>
              <span className="text-right max-sm:hidden">Tickets</span>
              <span className="text-right">Trend</span>
              <span className="text-right">Total</span>
            </div>
            {(() => {
              const maxScore = Math.max(...leaderboard.map(e => e.score), 1)
              const medalTint = ['rgba(212,167,44,0.16)', 'rgba(148,155,170,0.16)', 'rgba(180,116,74,0.16)']
              const medalColor = ['#d4a72c', '#a8b0bf', '#c98a5e']
              return leaderboard.map((e, i) => (
                <div
                  key={e.email}
                  className="grid grid-cols-[3rem_1fr_5rem_5rem_6rem_5rem] max-sm:grid-cols-[2.5rem_1fr_5rem_4rem] items-center gap-x-3 border-b border-zinc-800 last:border-b-0 px-5 py-3"
                >
                  <span>
                    {e.rank <= 3 ? (
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center"
                        style={{ background: medalTint[e.rank - 1], color: medalColor[e.rank - 1] }}
                        title={`#${e.rank}`}
                      >
                        <Medal size={15} strokeWidth={2.2} />
                      </span>
                    ) : (
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-zinc-500 border border-zinc-800">
                        {e.rank}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex items-center gap-2.5">
                    <span
                      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold"
                      style={{ background: 'color-mix(in srgb, var(--portal-accent) 14%, transparent)', color: 'var(--portal-accent)' }}
                    >
                      {(e.name ?? e.email).charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-zinc-100 truncate">{e.name ?? e.email}</span>
                      {e.name && <span className="block text-[11px] text-zinc-500 truncate">{e.email}</span>}
                    </span>
                  </span>
                  <span className="text-right text-sm text-zinc-300 max-sm:hidden">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <MessageCircle size={13} className="text-zinc-600" />{e.chats}
                    </span>
                  </span>
                  <span className="text-right text-sm text-zinc-300 max-sm:hidden">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      <Ticket size={13} className="text-zinc-600" />{e.tickets}
                    </span>
                  </span>
                  <span className="flex justify-end">
                    {e.movement === null ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: '#a78bfa', background: 'rgba(167,139,250,0.12)' }}>
                        <Sparkles size={11} /> new
                      </span>
                    ) : e.movement > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}>
                        <TrendingUp size={11} /> {e.movement}
                      </span>
                    ) : e.movement < 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}>
                        <TrendingDown size={11} /> {Math.abs(e.movement)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full text-zinc-500" style={{ background: 'var(--surface-tertiary)' }}>
                        <Minus size={11} /> held
                      </span>
                    )}
                  </span>
                  <span className="text-right">
                    <span className="block text-base font-bold text-zinc-100">{e.score}</span>
                    <span className="block h-1 mt-1 rounded-full ml-auto" style={{ width: `${Math.max(12, Math.round((e.score / maxScore) * 100))}%`, background: 'color-mix(in srgb, var(--portal-accent) 55%, transparent)' }} />
                  </span>
                </div>
              ))
            })()}
            <p className="px-5 py-3 text-[11px] text-zinc-600">
              Heavy use is a good sign — engaged people ask questions. It&apos;s also your best map of where a help doc could save everyone a trip.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'emerald' | 'accent' }) {
  const color = tone === 'emerald' ? 'var(--accent-emerald)' : tone === 'accent' ? 'var(--portal-accent)' : 'var(--text-primary)'
  return (
    <div className="rounded-xl border border-zinc-800 p-4" style={{ background: 'var(--surface)' }}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-4" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{title}</p>
        {right}
      </div>
      {children}
    </div>
  )
}
