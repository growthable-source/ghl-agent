/**
 * One small component per NodeType in the FlowResponse. Each renders the
 * labelled, colour-coded shape per the spec:
 *
 *   channelTrigger / crmTrigger  → coral pill
 *   routingRule / workingHours    → amber diamond
 *   stopCondition                 → purple diamond
 *   tool                          → blue rounded rect
 *   gate                          → small purple inline diamond
 *   failureEndpoint / pause / handover → red rounded square
 *   followUp                      → teal dashed rounded rect
 *   playbookRule                  → green rectangle (not used in Phase 1)
 *
 * Colour tokens use CSS vars (--accent-coral, --accent-blue, etc.) with
 * sensible hex fallbacks so the canvas works even when the project's
 * theme tokens aren't loaded.
 *
 * The exported `nodeTypes` map is what React Flow consumes — its keys
 * must match the NodeType union exactly.
 */

import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'

interface NodeData {
  label: string
  sourceId?: string
  meta?: Record<string, unknown>
  badges?: Array<{ kind: 'broken' | 'warning'; text: string }>
}

const PILL_STYLE: React.CSSProperties = {
  borderRadius: 9999,
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 500,
  border: '2px solid',
  minWidth: 160,
  textAlign: 'center',
  background: '#fff',
}

const DIAMOND_WRAP: React.CSSProperties = {
  // The diamond shape — rotate the inner box 45deg
  width: 100,
  height: 100,
  position: 'relative',
}

const DIAMOND_INNER: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  transform: 'rotate(45deg)',
  border: '2px solid',
  borderRadius: 8,
  background: '#fff',
}

const DIAMOND_LABEL: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  fontWeight: 500,
  textAlign: 'center',
  padding: 10,
  lineHeight: 1.2,
}

const RECT_STYLE: React.CSSProperties = {
  borderRadius: 8,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 500,
  border: '2px solid',
  minWidth: 160,
  textAlign: 'center',
  background: '#fff',
}

const ENDPOINT_STYLE: React.CSSProperties = {
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: '2px solid',
  minWidth: 140,
  textAlign: 'center',
  letterSpacing: 0.2,
  background: '#fff',
}

// ── Corner validation badge ────────────────────────────────────────────
// Renders as a small absolutely-positioned chip in the top-right of the
// node it's attached to. When multiple badges are present we display the
// most severe (broken > warning) — stacking chips would clutter the
// canvas. The badge auto-collapses to a coloured dot when text won't
// fit; the full text is always available via the `title` attribute.

const BADGE_TEXT_MAX = 18

function pickBadge(
  badges: Array<{ kind: 'broken' | 'warning'; text: string }> | undefined,
): { kind: 'broken' | 'warning'; text: string } | null {
  if (!badges || badges.length === 0) return null
  const broken = badges.find(b => b.kind === 'broken')
  if (broken) return broken
  return badges[0] ?? null
}

function CornerBadge({
  badge,
}: {
  badge: { kind: 'broken' | 'warning'; text: string }
}) {
  const isBroken = badge.kind === 'broken'
  const bg = isBroken
    ? 'var(--accent-red, #dc2626)'
    : 'var(--accent-amber, #d97706)'
  const fg = isBroken ? '#fff' : '#1f2937'
  const compact = badge.text.length > BADGE_TEXT_MAX

  return (
    <div
      title={badge.text}
      aria-label={badge.text}
      style={{
        position: 'absolute',
        top: -6,
        right: -6,
        background: bg,
        color: fg,
        borderRadius: 9999,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        padding: compact ? 0 : '3px 7px',
        width: compact ? 12 : 'auto',
        height: compact ? 12 : 'auto',
        minWidth: compact ? 12 : undefined,
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
        pointerEvents: 'auto',
        whiteSpace: 'nowrap',
        maxWidth: 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {compact ? '' : badge.text}
    </div>
  )
}


// ── Trigger nodes (source only) ────────────────────────────────────────

export function ChannelTriggerNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div
      style={{
        ...PILL_STYLE,
        position: 'relative',
        borderColor: 'var(--accent-coral, #fa4d2e)',
        color: 'var(--accent-coral, #fa4d2e)',
        background: 'var(--accent-coral-bg, #fff5f3)',
      }}
    >
      {badge && <CornerBadge badge={badge} />}
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function CrmTriggerNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div
      style={{
        ...PILL_STYLE,
        position: 'relative',
        borderColor: 'var(--accent-coral, #fa4d2e)',
        color: 'var(--accent-coral, #fa4d2e)',
        background: 'var(--accent-coral-bg, #fff5f3)',
      }}
    >
      {badge && <CornerBadge badge={badge} />}
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// ── Filter / gate diamonds (source + target) ───────────────────────────

function diamondColors(color: string, bg: string) {
  return { borderColor: color, background: bg, color }
}

export function RoutingRuleNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div style={DIAMOND_WRAP}>
      <Handle type="target" position={Position.Left} />
      <div style={{ ...DIAMOND_INNER, ...diamondColors('var(--accent-amber, #d97706)', 'var(--accent-amber-bg, #fffbeb)') }} />
      <div style={{ ...DIAMOND_LABEL, color: 'var(--accent-amber, #d97706)' }}>{data.label}</div>
      {badge && <CornerBadge badge={badge} />}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function WorkingHoursNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div style={DIAMOND_WRAP}>
      <Handle type="target" position={Position.Left} />
      <div style={{ ...DIAMOND_INNER, ...diamondColors('var(--accent-amber, #d97706)', 'var(--accent-amber-bg, #fffbeb)') }} />
      <div style={{ ...DIAMOND_LABEL, color: 'var(--accent-amber, #d97706)' }}>{data.label}</div>
      {badge && <CornerBadge badge={badge} />}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function StopConditionNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div style={DIAMOND_WRAP}>
      <Handle type="target" position={Position.Left} />
      <div style={{ ...DIAMOND_INNER, ...diamondColors('var(--accent-purple, #7c3aed)', 'var(--accent-purple-bg, #f5f3ff)') }} />
      <div style={{ ...DIAMOND_LABEL, color: 'var(--accent-purple, #7c3aed)' }}>{data.label}</div>
      {badge && <CornerBadge badge={badge} />}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// ── Tool nodes ─────────────────────────────────────────────────────────

export function ToolNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div
      style={{
        ...RECT_STYLE,
        position: 'relative',
        borderColor: 'var(--accent-blue, #2563eb)',
        color: 'var(--accent-blue, #2563eb)',
        background: 'var(--accent-blue-bg, #eff6ff)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {badge && <CornerBadge badge={badge} />}
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function GateNode({ data }: NodeProps<NodeData>) {
  // Small inline gate diamond — purple double-border
  return (
    <div style={{ width: 60, height: 60, position: 'relative' }}>
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          transform: 'rotate(45deg)',
          border: '2px double',
          borderRadius: 6,
          background: 'var(--accent-purple-bg, #f5f3ff)',
          borderColor: 'var(--accent-purple, #7c3aed)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--accent-purple, #7c3aed)',
        }}
      >
        {data.label}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// ── Endpoint nodes (target only) ───────────────────────────────────────

export function FailureEndpointNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      style={{
        ...ENDPOINT_STYLE,
        borderColor: 'var(--accent-red, #dc2626)',
        color: 'var(--accent-red, #dc2626)',
        background: 'var(--accent-red-bg, #fef2f2)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {data.label}
    </div>
  )
}

export function PauseEndpointNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      style={{
        ...ENDPOINT_STYLE,
        borderColor: 'var(--accent-red, #dc2626)',
        color: 'var(--accent-red, #dc2626)',
        background: 'var(--accent-red-bg, #fef2f2)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {data.label}
    </div>
  )
}

export function HandoverEndpointNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      style={{
        ...ENDPOINT_STYLE,
        borderColor: 'var(--accent-red, #dc2626)',
        color: 'var(--accent-red, #dc2626)',
        background: 'var(--accent-red-bg, #fef2f2)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {data.label}
    </div>
  )
}

// ── Auxiliary lanes ────────────────────────────────────────────────────

export function FollowUpNode({ data }: NodeProps<NodeData>) {
  const badge = pickBadge(data.badges)
  return (
    <div
      style={{
        ...RECT_STYLE,
        position: 'relative',
        borderColor: 'var(--accent-emerald, #0d9488)',
        color: 'var(--accent-emerald, #0d9488)',
        background: 'var(--accent-emerald-bg, #f0fdfa)',
        borderStyle: 'dashed',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {badge && <CornerBadge badge={badge} />}
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export function PlaybookRuleNode({ data }: NodeProps<NodeData>) {
  return (
    <div
      style={{
        ...RECT_STYLE,
        borderRadius: 4,
        borderColor: 'var(--accent-green, #16a34a)',
        color: 'var(--accent-green, #16a34a)',
        background: 'var(--accent-green-bg, #f0fdf4)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {data.label}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// ── React Flow nodeTypes map ───────────────────────────────────────────

export const nodeTypes = {
  channelTrigger: ChannelTriggerNode,
  crmTrigger: CrmTriggerNode,
  routingRule: RoutingRuleNode,
  workingHours: WorkingHoursNode,
  stopCondition: StopConditionNode,
  tool: ToolNode,
  gate: GateNode,
  failureEndpoint: FailureEndpointNode,
  pauseEndpoint: PauseEndpointNode,
  handoverEndpoint: HandoverEndpointNode,
  followUp: FollowUpNode,
  playbookRule: PlaybookRuleNode,
}
