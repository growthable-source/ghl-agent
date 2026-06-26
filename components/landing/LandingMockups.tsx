// Code-built landing-page product mockups.
//
// These replace the photoreal/illustrated PNGs that used to sit in the hero,
// Co-Pilot, and learning-loop sections. Everything here is pure JSX painted
// with the soft-light theme tokens (see app/globals.css) — no static assets,
// no stock imagery — so the visuals read as *our product* and stay crisp at
// any DPI while following the active theme.
//
// All three are presentational server components: no state, no client hooks.

// ── shared chrome ────────────────────────────────────────────────────────
// A faux app/browser title bar (traffic-light dots + label) shared by the
// mockups so they all sit in the same recognisable frame.
function WindowChrome({ label, accent }: { label: string; accent?: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
    >
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--surface-tertiary)' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--surface-tertiary)' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
      <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <div className="ml-auto">{accent}</div>
    </div>
  )
}

function LiveDot({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium" style={{ color: 'var(--accent-emerald)' }}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent-emerald)' }} />
      {label}
    </span>
  )
}

// ── 1. Dashboard stats (hero) ────────────────────────────────────────────
export function DashboardStatsMockup() {
  const stats = [
    { label: 'Conversations handled', value: '1,284', delta: '+18%' },
    { label: 'Demos booked', value: '96', delta: '+24%' },
    { label: 'Qualification rate', value: '73%', delta: '+6pts' },
    { label: 'Avg. response', value: '1.2s', delta: '−0.4s' },
  ]
  // Relative bar heights for the little throughput chart (percent of column).
  const bars = [38, 52, 44, 67, 58, 81, 73]
  const feed = [
    { tone: 'var(--accent-emerald)', text: 'Booked — Thursday 2:00 PM', tag: 'book_appointment' },
    { tone: 'var(--accent-blue)', text: 'Qualified lead → synced to CRM', tag: 'update_contact' },
    { tone: 'var(--accent-primary)', text: 'Improvement applied to prompt', tag: 'auto-tuned' },
  ]
  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 60px -24px rgba(0,0,0,0.18)' }}>
      <WindowChrome label="Xovera · Dashboard" accent={<LiveDot label="Live" />} />
      <div className="p-5">
        <div className="grid grid-cols-2 gap-3 mb-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl p-3.5" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
              <div className="text-[0.6875rem] mb-1.5 leading-tight" style={{ color: 'var(--text-tertiary)' }}>{s.label}</div>
              <div className="flex items-end gap-2">
                <span className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>{s.value}</span>
                <span className="text-[0.625rem] font-semibold mb-0.5" style={{ color: 'var(--accent-emerald)' }}>{s.delta}</span>
              </div>
            </div>
          ))}
        </div>

        {/* throughput chart */}
        <div className="rounded-xl p-3.5 mb-4" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[0.6875rem] font-medium" style={{ color: 'var(--text-tertiary)' }}>Conversations / day</span>
            <span className="text-[0.625rem]" style={{ color: 'var(--text-tertiary)' }}>last 7 days</span>
          </div>
          <div className="flex items-end gap-2 h-16">
            {bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm"
                style={{
                  height: `${h}%`,
                  background: i === bars.length - 1 ? 'var(--accent-primary)' : 'rgba(250,77,46,0.22)',
                }}
              />
            ))}
          </div>
        </div>

        {/* live activity feed */}
        <div className="space-y-2">
          {feed.map((f) => (
            <div key={f.text} className="flex items-center gap-2.5 text-xs">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: f.tone }} />
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{f.text}</span>
              <span className="ml-auto shrink-0 text-[0.625rem] rounded px-1.5 py-0.5" style={{ fontFamily: 'var(--font-dm-mono), monospace', color: 'var(--text-tertiary)', background: 'var(--surface-tertiary)' }}>{f.tag}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 2. Meeting / Co-Pilot ────────────────────────────────────────────────
// A themed recreation of a video-call grid (no photos) with the AI Agent
// participant tile showing a live, real-time meeting summary.
export function MeetingMockup() {
  const people = [
    { name: 'Lena Park', initials: 'LP', tint: 'var(--accent-blue)' },
    { name: 'Marcus T.', initials: 'MT', tint: 'var(--accent-emerald)' },
    { name: 'Priya Shah', initials: 'PS', tint: 'var(--accent-primary)' },
    { name: 'David Wilson', initials: 'DW', tint: 'var(--accent-blue)' },
  ]
  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 60px -24px rgba(0,0,0,0.18)' }}>
      <WindowChrome label="Live meeting" accent={<LiveDot label="Recording" />} />
      <div className="p-4">
        <div className="grid grid-cols-3 gap-2.5">
          {people.map((p) => (
            <div
              key={p.name}
              className="relative rounded-lg aspect-[4/3] flex items-center justify-center"
              style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
            >
              <span
                className="w-9 h-9 rounded-full flex items-center justify-center text-[0.6875rem] font-bold"
                style={{ background: p.tint, color: '#fff' }}
              >
                {p.initials}
              </span>
              <span className="absolute bottom-1.5 left-1.5 text-[0.5625rem] px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.45)', color: '#fff' }}>{p.name}</span>
            </div>
          ))}

          {/* AI Agent tile — spans two columns, carries the live summary */}
          <div
            className="col-span-2 rounded-lg p-3.5"
            style={{ background: 'linear-gradient(135deg, rgba(250,77,46,0.10), var(--surface-secondary))', border: '1px solid var(--accent-primary)' }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'var(--accent-primary)' }}>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="8" width="16" height="11" rx="2" /><path d="M12 8V4M9 13h.01M15 13h.01" /></svg>
              </span>
              <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>AI Agent</span>
              <span className="ml-auto text-[0.625rem]" style={{ color: 'var(--accent-primary)' }}>Meeting summary</span>
            </div>
            <ul className="space-y-1.5 text-[0.6875rem] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              <li className="flex gap-1.5"><span style={{ color: 'var(--accent-primary)' }}>•</span>Walked through Q2 roadmap and milestones.</li>
              <li className="flex gap-1.5"><span style={{ color: 'var(--accent-primary)' }}>•</span>Demoed the live-chat handoff flow.</li>
              <li className="flex gap-1.5"><span style={{ color: 'var(--accent-primary)' }}>•</span>Next step: send pricing by Friday.</li>
            </ul>
            <div className="mt-2.5 flex items-center gap-1.5 text-[0.625rem]" style={{ color: 'var(--text-tertiary)' }}>
              Generating summary
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)' }} />
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)', animationDelay: '0.2s' }} />
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent-primary)', animationDelay: '0.4s' }} />
              </span>
            </div>
          </div>
        </div>

        {/* control bar */}
        <div className="flex items-center justify-center gap-3 mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          {['mic', 'video', 'share'].map((c) => (
            <span key={c} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-tertiary)' }}>
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: 'var(--text-tertiary)' }} />
            </span>
          ))}
          <span className="px-3 h-7 rounded-full flex items-center text-[0.625rem] font-semibold" style={{ background: 'var(--accent-red-bg, rgba(220,38,38,0.12))', color: '#dc2626' }}>Leave</span>
        </div>
      </div>
    </div>
  )
}

// ── 3. Agent builder / learning loop ─────────────────────────────────────
// The auditor → apply-to-prompt moment that the learning-loop copy describes.
export function AgentBuilderMockup() {
  return (
    <div className="w-full rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 24px 60px -24px rgba(0,0,0,0.18)' }}>
      <WindowChrome label="Xovera · Conversation review" accent={<span className="text-[0.625rem]" style={{ color: 'var(--text-tertiary)' }}>auto-audit</span>} />
      <div className="p-5">
        {/* flagged transcript turn */}
        <div className="text-[0.625rem] uppercase tracking-wide mb-2 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Flagged turn</div>
        <div className="rounded-xl p-3.5 mb-4 space-y-2 text-xs" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', fontFamily: 'var(--font-dm-mono), monospace' }}>
          <div className="flex gap-2">
            <span className="shrink-0 w-12 text-right font-medium" style={{ color: 'var(--accent-blue)' }}>Caller</span>
            <span style={{ color: 'var(--text-secondary)' }}>My name is Sarah, I emailed yesterday.</span>
          </div>
          <div className="flex gap-2">
            <span className="shrink-0 w-12 text-right font-medium" style={{ color: 'var(--accent-primary)' }}>Agent</span>
            <span style={{ color: 'var(--text-secondary)' }}>Sure — can I grab your name to start?</span>
          </div>
        </div>

        {/* proposed fix */}
        <div className="text-[0.625rem] uppercase tracking-wide mb-2 font-semibold" style={{ color: 'var(--text-tertiary)' }}>Proposed fix</div>
        <div className="rounded-xl p-3.5 mb-4" style={{ background: 'var(--accent-primary-bg)', border: '1px solid var(--accent-primary)' }}>
          <div className="flex items-start gap-2">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4" /></svg>
            <p className="text-xs leading-snug" style={{ color: 'var(--text-primary)' }}>
              Add to prompt: <span style={{ color: 'var(--accent-primary)' }}>&ldquo;Never ask for information the contact has already provided.&rdquo;</span>
            </p>
          </div>
        </div>

        {/* applied state */}
        <div className="flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--accent-emerald)' }}>
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Applied to live agent
          </span>
          <span className="text-[0.625rem]" style={{ color: 'var(--text-tertiary)' }}>~30s · no redeploy</span>
        </div>
      </div>
    </div>
  )
}
