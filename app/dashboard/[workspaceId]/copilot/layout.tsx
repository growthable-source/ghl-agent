'use client'

/**
 * Co-Pilot section layout — minimal shell.
 *
 * The realtime screen-share Co-Pilot is its own top-level surface in
 * the dashboard (sidebar entry "Co-Pilot" → /copilot). v0 is a single
 * page (the live session UI lands directly here); we'll add session
 * history + per-session review pages under this layout once they
 * exist. Keeping the shell as featureless as the Voice section's so
 * the child pages own their hero — no double-rendered headers.
 */

export default function CopilotLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col h-full">{children}</div>
}
