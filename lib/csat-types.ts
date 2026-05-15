/**
 * CSAT response shape — shared between the API endpoint that produces
 * it, the dashboard page that consumes it, the print/email report
 * renderer, and any future surface (digest, Slack, Linear webhook).
 *
 * Keeping the types in one place avoids the drift bug where adding a
 * field to the response forgot one of the four consumers. Every
 * caller imports from here.
 *
 * Pure shape — no behaviour, no runtime values. Safe for both server
 * and client bundles.
 */

export interface CsatBrandLite {
  id: string
  name: string
  primaryColor: string | null
}

export interface CsatHandlerStats {
  count: number
  avg: number
}

export interface CsatTrend {
  priorAvg: number | null
  priorCount: number
  priorResponseRate: number
  deltaAvg: number | null
  deltaCount: number
  deltaResponseRate: number
}

export interface CsatRollupByAgent {
  agentId: string | null
  name: string
  count: number
  avg: number
}

export interface CsatRollupByOperator {
  userId: string
  name: string
  email: string | null
  image: string | null
  count: number
  avg: number
}

export interface CsatRollupByBrand {
  brandId: string | null
  name: string
  color: string | null
  count: number
  avg: number
}

export interface CsatRecentRating {
  conversationId: string
  widgetId: string
  widgetName: string
  brandId: string | null
  brandName: string | null
  agentId: string | null
  agentName: string | null
  handler: 'ai' | 'human'
  rating: number
  comment: string | null
  submittedAt: string | null
  visitorLabel: string
}

export interface CsatCommentHighlight {
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

export interface CsatResponse {
  days: number
  from?: string
  to?: string
  filters: {
    brandId: string | null
    rating: number | null
    handler: 'ai' | 'human' | null
  }
  totalRated: number
  closedTotal: number
  responseRate: number
  averageRating: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  byAgent: CsatRollupByAgent[]
  byOperator: CsatRollupByOperator[]
  byBrand: CsatRollupByBrand[]
  byHandler: { ai: CsatHandlerStats; human: CsatHandlerStats }
  trend: CsatTrend
  commentHighlights: {
    needsReview: CsatCommentHighlight[]
    brightSpots: CsatCommentHighlight[]
  }
  allBrands: CsatBrandLite[]
  recent: CsatRecentRating[]
  notMigrated?: boolean
  error?: string
}
