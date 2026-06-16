import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'
import { costUsd, baselineCostUsd } from '@/lib/llm/pricing'

export const dynamic = 'force-dynamic'

interface SearchParams { days?: string }

const WINDOWS = [7, 30, 90]

/**
 * LLM cost dashboard — turns the LlmUsageDaily rollup into dollars and
 * shows realized savings vs running everything on Claude Sonnet (the model
 * the agent ran on before DeepSeek). Spend, savings, fallback rate, and
 * breakdowns by model + surface.
 */
export default async function AdminCostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 30
  const sinceDay = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  let rows: Array<{ surface: string; modelKey: string; provider: string; calls: number; fellBackCalls: number; inputTokens: bigint; outputTokens: bigint }> = []
  let notMigrated = false
  try {
    rows = await db.llmUsageDaily.findMany({
      where: { day: { gte: sinceDay } },
      select: { surface: true, modelKey: true, provider: true, calls: true, fellBackCalls: true, inputTokens: true, outputTokens: true },
    })
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.code === 'P2021') notMigrated = true
    else throw err
  }

  logAdminAction({ admin: session, action: 'view_llm_costs', meta: { days, rows: rows.length } })

  // ─── Aggregate ──────────────────────────────────────────────────────────
  type Agg = { calls: number; fellBack: number; inTok: number; outTok: number }
  const byModel = new Map<string, Agg & { provider: string }>()
  const bySurface = new Map<string, Agg>()
  let totalCalls = 0, totalFellBack = 0, totalActual = 0, totalBaseline = 0

  for (const r of rows) {
    const inTok = Number(r.inputTokens)
    const outTok = Number(r.outputTokens)
    totalCalls += r.calls
    totalFellBack += r.fellBackCalls
    totalActual += costUsd(r.modelKey, inTok, outTok)
    totalBaseline += baselineCostUsd(inTok, outTok)

    const m = byModel.get(r.modelKey) ?? { calls: 0, fellBack: 0, inTok: 0, outTok: 0, provider: r.provider }
    m.calls += r.calls; m.fellBack += r.fellBackCalls; m.inTok += inTok; m.outTok += outTok
    byModel.set(r.modelKey, m)

    const s = bySurface.get(r.surface) ?? { calls: 0, fellBack: 0, inTok: 0, outTok: 0 }
    s.calls += r.calls; s.inTok += inTok; s.outTok += outTok
    bySurface.set(r.surface, s)
  }

  const savings = totalBaseline - totalActual
  const savingsPct = totalBaseline > 0 ? (savings / totalBaseline) * 100 : 0
  const fallbackPct = totalCalls > 0 ? (totalFellBack / totalCalls) * 100 : 0
  const monthlyProjection = days > 0 ? (totalActual / days) * 30 : 0

  const models = [...byModel.entries()]
    .map(([key, a]) => ({ key, ...a, cost: costUsd(key, a.inTok, a.outTok) }))
    .sort((a, b) => b.cost - a.cost)
  // A surface can mix models, so its "cost" is shown as the Sonnet-equivalent
  // — a stable size indicator of how much work each surface drives.
  const surfaces = [...bySurface.entries()]
    .map(([key, a]) => ({ key, ...a, cost: baselineCostUsd(a.inTok, a.outTok) }))
    .sort((a, b) => b.cost - a.cost)

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">LLM costs</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Realized model spend and savings vs running everything on Claude Sonnet. From the per-call
            <code className="mx-1 px-1 py-0.5 rounded bg-zinc-900 text-zinc-400">LlmUsageDaily</code>
            rollup · last {days} days.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {WINDOWS.map(w => (
            <Link
              key={w}
              href={`/admin/costs?days=${w}`}
              className={`px-2.5 py-1.5 rounded border transition-colors ${w === days ? 'border-amber-600 text-amber-300 bg-amber-950/30' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}
            >{w}d</Link>
          ))}
        </div>
      </div>

      {notMigrated && (
        <div className="mb-4 p-3 rounded border border-amber-700 bg-amber-950/40 text-xs text-amber-300">
          The <code className="mx-1 px-1 py-0.5 rounded bg-amber-900/60">LlmUsageDaily</code> table doesn&apos;t exist yet — run the cost-telemetry CREATE TABLE against the DB to start collecting.
        </div>
      )}

      {!notMigrated && totalCalls === 0 && (
        <div className="mb-4 p-3 rounded border border-zinc-800 bg-zinc-900/40 text-xs text-zinc-400">
          No model calls recorded in this window yet. Telemetry fills in as agents and generators run.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="Spend" value={fmtUsd(totalActual)} sub={`≈ ${fmtUsd(monthlyProjection)}/mo at this rate`} />
        <Kpi label="Saved vs all-Sonnet" value={fmtUsd(savings)} sub={`${savingsPct.toFixed(0)}% lower than baseline`} tone="emerald" />
        <Kpi label="Model calls" value={totalCalls.toLocaleString()} sub={`${fmtUsd(totalBaseline)} on Sonnet baseline`} />
        <Kpi label="Fell back to Claude" value={`${fallbackPct.toFixed(1)}%`} sub={`${totalFellBack.toLocaleString()} of ${totalCalls.toLocaleString()} calls`} tone={fallbackPct > 25 ? 'amber' : 'default'} />
      </div>

      {/* By model */}
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">By model</h2>
      <div className="rounded border border-zinc-800 overflow-hidden mb-6">
        <table className="w-full text-xs">
          <thead className="bg-zinc-950">
            <tr className="text-left text-zinc-500">
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Provider</th>
              <th className="px-3 py-2 font-medium text-right">Calls</th>
              <th className="px-3 py-2 font-medium text-right">Input tok</th>
              <th className="px-3 py-2 font-medium text-right">Output tok</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
              <th className="px-3 py-2 font-medium text-right">% spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {models.map(m => (
              <tr key={m.key} className="hover:bg-zinc-950/60">
                <td className="px-3 py-2 font-medium text-zinc-200">{m.key}</td>
                <td className="px-3 py-2 text-zinc-500">{m.provider}</td>
                <td className="px-3 py-2 text-zinc-400 text-right">{m.calls.toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-400 text-right">{fmtTok(m.inTok)}</td>
                <td className="px-3 py-2 text-zinc-400 text-right">{fmtTok(m.outTok)}</td>
                <td className="px-3 py-2 text-zinc-200 text-right">{fmtUsd(m.cost)}</td>
                <td className="px-3 py-2 text-zinc-500 text-right">{totalActual > 0 ? `${((m.cost / totalActual) * 100).toFixed(0)}%` : '—'}</td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-zinc-600">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* By surface */}
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">By surface</h2>
      <div className="rounded border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-950">
            <tr className="text-left text-zinc-500">
              <th className="px-3 py-2 font-medium">Surface</th>
              <th className="px-3 py-2 font-medium text-right">Calls</th>
              <th className="px-3 py-2 font-medium text-right">Input tok</th>
              <th className="px-3 py-2 font-medium text-right">Output tok</th>
              <th className="px-3 py-2 font-medium text-right">Sonnet-equiv cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {surfaces.map(s => (
              <tr key={s.key} className="hover:bg-zinc-950/60">
                <td className="px-3 py-2 font-medium text-zinc-200">{s.key}</td>
                <td className="px-3 py-2 text-zinc-400 text-right">{s.calls.toLocaleString()}</td>
                <td className="px-3 py-2 text-zinc-400 text-right">{fmtTok(s.inTok)}</td>
                <td className="px-3 py-2 text-zinc-400 text-right">{fmtTok(s.outTok)}</td>
                <td className="px-3 py-2 text-zinc-300 text-right">{fmtUsd(s.cost)}</td>
              </tr>
            ))}
            {surfaces.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-600">No data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-400' : tone === 'amber' ? 'text-amber-400' : 'text-zinc-100'
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0'
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`
  return `$${n.toFixed(3)}`
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}
