/**
 * CSAT report renderer — shared by the print page and the email
 * endpoint so both surfaces show the exact same numbers / layout.
 *
 * Pure-data: takes the response shape from /api/workspaces/:id/csat
 * plus workspace name + filter context, returns inline-styled HTML
 * safe to embed in a Resend email OR drop into a Next.js page as
 * dangerouslySetInnerHTML for `window.print()`.
 *
 * No external CSS — every style is inline so email clients (Gmail,
 * Outlook, Apple Mail) render it consistently. The same constraint
 * works for browser print since print styles inherit normally.
 */

interface CommentHighlight {
  conversationId: string
  widgetName: string
  brandName: string | null
  agentName: string | null
  operatorName: string | null
  handler: 'ai' | 'human'
  rating: number
  comment: string
  submittedAt: string | null
  visitorLabel: string
}

interface CsatData {
  days: number
  filters: { brandId: string | null; rating: number | null; handler: 'ai' | 'human' | null }
  totalRated: number
  closedTotal: number
  responseRate: number
  averageRating: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  byAgent: Array<{ agentId: string | null; name: string; count: number; avg: number }>
  byOperator?: Array<{ userId: string; name: string; email: string | null; count: number; avg: number }>
  byBrand: Array<{ brandId: string | null; name: string; color: string | null; count: number; avg: number }>
  byHandler: { ai: { count: number; avg: number }; human: { count: number; avg: number } }
  trend?: {
    priorAvg: number | null
    priorCount: number
    priorResponseRate: number
    deltaAvg: number | null
    deltaCount: number
    deltaResponseRate: number
  }
  commentHighlights?: {
    needsReview: CommentHighlight[]
    brightSpots: CommentHighlight[]
  }
  allBrands: Array<{ id: string; name: string; primaryColor: string | null }>
  recent: Array<{
    conversationId: string
    widgetName: string
    brandName: string | null
    agentName: string | null
    handler: 'ai' | 'human'
    rating: number
    comment: string | null
    submittedAt: string | null
    visitorLabel: string
  }>
}

interface RenderOpts {
  workspaceName: string
  workspaceId: string
  generatedAt?: Date
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!))
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function filterSummary(data: CsatData): string {
  const parts: string[] = [`last ${data.days} days`]
  if (data.filters.rating) parts.push(`${data.filters.rating}★ only`)
  if (data.filters.brandId) {
    const brand = data.allBrands.find(b => b.id === data.filters.brandId)
    parts.push(`brand: ${brand?.name || 'unknown'}`)
  }
  if (data.filters.handler) parts.push(`${data.filters.handler === 'ai' ? 'AI-only' : 'human-touched'} chats`)
  return parts.join(' · ')
}

export function renderCsatReportSubject(data: CsatData, workspaceName: string): string {
  const brandLabel = data.filters.brandId
    ? ` — ${data.allBrands.find(b => b.id === data.filters.brandId)?.name || 'Brand'}`
    : ''
  const score = data.totalRated > 0 ? ` (${data.averageRating.toFixed(2)}/5)` : ''
  return `${workspaceName} CSAT report${brandLabel}${score}`
}

export function renderCsatReportHtml(data: CsatData, opts: RenderOpts): string {
  const generatedAt = opts.generatedAt ?? new Date()
  const maxBar = Math.max(1, ...(['1','2','3','4','5'] as const).map(k => data.distribution[k]))

  const scorecard = (label: string, value: string, hint: string) => `
    <td style="padding:14px 16px;background:#f9fafb;border-radius:8px;width:33%;vertical-align:top;border:1px solid #e5e7eb;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:6px;">${label}</div>
      <div style="font-size:24px;font-weight:700;color:#111827;line-height:1.1;">${value}</div>
      <div style="font-size:11px;color:#6b7280;margin-top:3px;">${hint}</div>
    </td>`

  const histRow = (k: 1 | 2 | 3 | 4 | 5) => {
    const count = data.distribution[String(k) as '1'|'2'|'3'|'4'|'5']
    const pct = Math.round((count / maxBar) * 100)
    const color = k >= 4 ? '#22c55e' : k === 3 ? '#f59e0b' : '#ef4444'
    return `
      <tr>
        <td style="width:30px;font-size:12px;color:#374151;padding:4px 0;font-weight:600;">${k}★</td>
        <td style="padding:4px 8px;">
          <div style="height:14px;background:#e5e7eb;border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};"></div>
          </div>
        </td>
        <td style="width:40px;text-align:right;font-size:12px;color:#6b7280;font-variant-numeric:tabular-nums;">${count}</td>
      </tr>`
  }

  const aiVsHuman = (() => {
    const ai = data.byHandler.ai
    const human = data.byHandler.human
    if (ai.count + human.count === 0) return ''
    const diff = human.avg - ai.avg
    const diffStr = ai.count > 0 && human.count > 0
      ? `<p style="margin:8px 0 0;font-size:12px;color:#6b7280;">Difference: <strong style="color:#111827;">${diff >= 0 ? '+' : ''}${diff.toFixed(2)}</strong> — ${diff > 0 ? 'human-touched chats rate higher' : diff < 0 ? 'AI-only chats rate higher' : 'tied'}</p>`
      : ''
    const cell = (label: string, helper: string, count: number, avg: number) => `
      <td style="padding:14px 16px;border:1px solid #e5e7eb;border-radius:8px;width:50%;vertical-align:top;">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:6px;">${label}</div>
        <div style="font-size:24px;font-weight:700;color:#111827;line-height:1.1;">${count > 0 ? avg.toFixed(2) : '—'}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:3px;">${count} rating${count === 1 ? '' : 's'} · ${helper}</div>
      </td>`
    return `
      <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">AI vs human</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin:0;">
        <tr>
          ${cell('AI only', 'no human took over', ai.count, ai.avg)}
          ${cell('Human-touched', 'operator stepped in', human.count, human.avg)}
        </tr>
      </table>
      ${diffStr}`
  })()

  const brandRow = (b: typeof data.byBrand[number]) => `
    <tr>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;">
        ${b.color ? `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${escapeHtml(b.color)};margin-right:8px;vertical-align:middle;"></span>` : ''}
        ${escapeHtml(b.name)}
      </td>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:right;font-variant-numeric:tabular-nums;">${b.count}</td>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;font-variant-numeric:tabular-nums;width:80px;"><strong>${b.avg.toFixed(2)}</strong> / 5</td>
    </tr>`

  const brandsSection = data.byBrand.length > 0 ? `
    <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">By brand</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
      ${data.byBrand.map(brandRow).join('')}
    </table>` : ''

  const agentRow = (a: typeof data.byAgent[number]) => `
    <tr>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;">${escapeHtml(a.name)}</td>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:right;font-variant-numeric:tabular-nums;">${a.count}</td>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;font-variant-numeric:tabular-nums;width:80px;"><strong>${a.avg.toFixed(2)}</strong> / 5</td>
    </tr>`

  const agentsSection = data.byAgent.length > 0 ? `
    <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">By AI agent</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
      ${data.byAgent.map(agentRow).join('')}
    </table>` : ''

  const operatorRow = (o: NonNullable<CsatData['byOperator']>[number]) => `
    <tr>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;">
        ${escapeHtml(o.name)}${o.email && o.email !== o.name ? ` <span style="color:#9ca3af;font-size:11px;">${escapeHtml(o.email)}</span>` : ''}
      </td>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:right;font-variant-numeric:tabular-nums;">${o.count}</td>
      <td style="padding:8px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;text-align:right;font-variant-numeric:tabular-nums;width:80px;"><strong>${o.avg.toFixed(2)}</strong> / 5</td>
    </tr>`

  const operatorsSection = data.byOperator && data.byOperator.length > 0 ? `
    <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">By human operator</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
      ${data.byOperator.map(operatorRow).join('')}
    </table>` : ''

  const highlightRow = (h: CommentHighlight) => {
    const bg = h.rating >= 4 ? '#d1fae5' : h.rating === 3 ? '#fef3c7' : '#fee2e2'
    const fg = h.rating >= 4 ? '#065f46' : h.rating === 3 ? '#92400e' : '#991b1b'
    return `
      <tr>
        <td style="padding:10px 8px;border-top:1px solid #e5e7eb;vertical-align:top;">
          <span style="display:inline-block;font-weight:600;font-size:12px;padding:2px 8px;border-radius:4px;background:${bg};color:${fg};">${h.rating}★</span>
        </td>
        <td style="padding:10px 4px;border-top:1px solid #e5e7eb;font-size:13px;color:#111827;vertical-align:top;">
          <div style="font-style:italic;color:#374151;line-height:1.4;">“${escapeHtml(h.comment)}”</div>
          <div style="margin-top:4px;font-size:11px;color:#6b7280;">
            ${escapeHtml(h.visitorLabel)}${h.brandName ? ` · ${escapeHtml(h.brandName)}` : ''}${h.operatorName ? ` · ${escapeHtml(h.operatorName)}` : h.agentName ? ` · ${escapeHtml(h.agentName)}` : ''}
          </div>
        </td>
      </tr>`
  }

  const highlightsSection = data.commentHighlights && (data.commentHighlights.needsReview.length > 0 || data.commentHighlights.brightSpots.length > 0) ? `
    <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">Comment highlights</h2>
    ${data.commentHighlights.needsReview.length > 0 ? `
      <p style="font-size:12px;color:#991b1b;margin:8px 0 4px;font-weight:600;">⚠ Needs review — lowest-rated chats with feedback</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #fee2e2;overflow:hidden;margin-bottom:12px;">
        ${data.commentHighlights.needsReview.map(highlightRow).join('')}
      </table>` : ''}
    ${data.commentHighlights.brightSpots.length > 0 ? `
      <p style="font-size:12px;color:#065f46;margin:8px 0 4px;font-weight:600;">✨ Bright spots — top-rated chats with feedback</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #d1fae5;overflow:hidden;">
        ${data.commentHighlights.brightSpots.map(highlightRow).join('')}
      </table>` : ''}
  ` : ''

  const recentRow = (r: typeof data.recent[number]) => {
    const bg = r.rating >= 4 ? '#d1fae5' : r.rating === 3 ? '#fef3c7' : '#fee2e2'
    const fg = r.rating >= 4 ? '#065f46' : r.rating === 3 ? '#92400e' : '#991b1b'
    return `
      <tr>
        <td style="padding:10px 4px;border-top:1px solid #e5e7eb;vertical-align:top;">
          <span style="display:inline-block;font-weight:600;font-size:12px;padding:2px 8px;border-radius:4px;background:${bg};color:${fg};">${r.rating}★</span>
        </td>
        <td style="padding:10px 4px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;vertical-align:top;">
          <div><strong>${escapeHtml(r.visitorLabel)}</strong> · ${escapeHtml(r.widgetName)}${r.brandName ? ` · ${escapeHtml(r.brandName)}` : ''}${r.agentName ? ` · ${escapeHtml(r.agentName)}` : ''} <span style="font-size:9px;text-transform:uppercase;color:#6b7280;margin-left:4px;">${r.handler}</span></div>
          ${r.comment ? `<div style="margin-top:4px;font-style:italic;color:#374151;">“${escapeHtml(r.comment)}”</div>` : ''}
        </td>
        <td style="padding:10px 4px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:right;vertical-align:top;">
          ${r.submittedAt ? escapeHtml(new Date(r.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : ''}
        </td>
      </tr>`
  }

  const recentSection = data.recent.length > 0 ? `
    <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">Recent ratings</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
      ${data.recent.map(recentRow).join('')}
    </table>` : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.workspaceName)} CSAT report</title></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#ffffff;color:#111827;">
<div style="max-width:680px;margin:0 auto;">
  <div style="margin-bottom:20px;">
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#111827;">CSAT report — ${escapeHtml(opts.workspaceName)}</h1>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">${escapeHtml(filterSummary(data))} · generated ${escapeHtml(fmtDate(generatedAt))}</p>
  </div>

  ${data.totalRated === 0 ? `
    <div style="padding:24px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:13px;">
      No ratings in this window with the selected filters.
    </div>` : `

    <table role="presentation" width="100%" cellpadding="0" cellspacing="8" style="margin:0 0 16px;">
      <tr>
        ${scorecard(
          'Average rating',
          `${data.averageRating.toFixed(2)} / 5`,
          `${'⭐'.repeat(Math.round(data.averageRating))}${data.trend?.deltaAvg ? ` · ${data.trend.deltaAvg > 0 ? '+' : ''}${data.trend.deltaAvg.toFixed(2)} vs prior ${data.days}d` : ''}`,
        )}
        ${scorecard(
          'Ratings collected',
          String(data.totalRated),
          `of ${data.closedTotal} closed chats${data.trend ? ` · ${data.trend.deltaCount >= 0 ? '+' : ''}${data.trend.deltaCount} vs prior` : ''}`,
        )}
        ${scorecard(
          'Response rate',
          `${Math.round(data.responseRate * 100)}%`,
          `of closed chats rated${data.trend ? ` · ${data.trend.deltaResponseRate >= 0 ? '+' : ''}${Math.round(data.trend.deltaResponseRate * 100)}pp vs prior` : ''}`,
        )}
      </tr>
    </table>

    ${aiVsHuman}

    <h2 style="font-size:14px;font-weight:600;color:#111827;margin:24px 0 8px;">Rating distribution</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:8px;border:1px solid #e5e7eb;padding:12px;">
      ${(['5','4','3','2','1'] as const).map(k => histRow(Number(k) as 1|2|3|4|5)).join('')}
    </table>

    ${brandsSection}
    ${agentsSection}
    ${operatorsSection}
    ${highlightsSection}
    ${recentSection}
  `}

  <p style="margin:32px 0 0;font-size:11px;color:#9ca3af;text-align:center;">
    Voxility CSAT report. Generated for ${escapeHtml(opts.workspaceName)}.
  </p>
</div>
</body></html>`
}
