'use client'

/**
 * Custom React Flow edge types for the visual workflow canvas.
 *
 * The default smoothstep edge renders its label through `EdgeText`, which
 * draws a foreignObject backed `div` — there's no first-class API for a
 * tooltip on the label. Long edge labels (e.g. "Routing: tag = vip-renewal
 * AND keyword: pricing") would either overflow the canvas or be illegible
 * when truncated, with no way for the operator to see the full text.
 *
 * `LabeledEdge` solves both:
 *   • Truncates the visible label after ~20 chars with an ellipsis
 *   • Renders the full text in a `<title>` element so the browser shows a
 *     native tooltip on hover — works in every modern browser without us
 *     needing to wire up positioning, portals, or click-outside handling.
 *
 * The label badge is a small white pill rendered via `EdgeLabelRenderer`
 * (which mounts in screen coordinates outside the SVG) so we can use real
 * CSS for padding/borders. The `<title>` inside it is what triggers the
 * browser tooltip.
 */

import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from 'reactflow'

const LABEL_TRUNCATE = 20

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1).trimEnd() + '…'
}

function LabeledEdgeImpl(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    style,
    markerEnd,
    markerStart,
  } = props

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const text = typeof label === 'string' ? label : ''
  const displayText = truncate(text, LABEL_TRUNCATE)
  const isTruncated = text.length > LABEL_TRUNCATE

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} markerStart={markerStart} />
      {text && (
        <EdgeLabelRenderer>
          <div
            title={isTruncated ? text : undefined}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              background: 'var(--surface, #ffffff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 6,
              padding: '2px 6px',
              fontSize: 10,
              fontWeight: 500,
              color: 'var(--text-secondary, #4b5563)',
              pointerEvents: 'all',
              whiteSpace: 'nowrap',
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: isTruncated ? 'help' : 'default',
            }}
            className="nodrag nopan"
          >
            {displayText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const LabeledEdge = memo(LabeledEdgeImpl)

export const edgeTypes = {
  labeled: LabeledEdge,
}
