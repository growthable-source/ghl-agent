'use client'

/**
 * Voice section layout.
 *
 * The voice surface is its own top-level section in the dashboard
 * (sidebar entry "Voice agents" → /voice). This layout is the shell
 * for the list page, the wizard, and any voice-only sub-routes. The
 * per-agent detail pages still live under /agents/[agentId]/* (single
 * source of truth) — voice agents just get a dedicated landing page,
 * wizard, and a sidebar peer to text agents.
 *
 * Intentionally minimal: no breadcrumb of its own, no tab strip. The
 * child pages own their headers so the wizard's stepper and the list
 * page's hero can sit at the very top of the canvas.
 */

export default function VoiceLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col h-full">{children}</div>
}
