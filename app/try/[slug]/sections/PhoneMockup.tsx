'use client'

/**
 * The animated incoming-call iPhone mockup — the hero visual. Two internal
 * layers: INCOMING CALL (ringing, decline/answer) and ACTIVE CALL
 * (connecting/live, single hang-up button). Which layer shows is driven
 * entirely by `onCall` (derived from usePublicVoiceCall's state upstream) —
 * this component has no call logic of its own, just presentation +
 * animation. Ripple rings use Tailwind's built-in `animate-ping`; the
 * wiggle + ringing-dots keyframes live in globals.css (`.xv-phone-wiggle` /
 * `.xv-dot`) so every mounted instance shares one animation definition.
 */

function DeclineIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="white" strokeWidth={2.25}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function AnswerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" />
    </svg>
  )
}

function ActiveCallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7">
      <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M9 9v3a3 3 0 004.83 2.38M15 9.34V6a3 3 0 00-5.94-.6M5 10v1a7 7 0 0010.61 5.99M19 11a7 7 0 01-1.02 3.65M12 18.5V21" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.05-3.15A7.94 7.94 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}

function RemindIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="w-3.5 h-3.5" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function RingDots() {
  return (
    <span className="inline-flex gap-0.5 ml-1 align-middle">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="xv-dot inline-block w-1 h-1 rounded-full"
          style={{ background: 'currentColor', animationDelay: `${i * 200}ms` }}
        />
      ))}
    </span>
  )
}

function formatTime(secs: number | null): string {
  if (secs === null) return '0:00'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export interface PhoneMockupProps {
  businessName: string
  /** Presentation state — 'idle' shows the ringing incoming-call screen,
   *  'connecting'/'live' show the active-call screen. */
  onCall: boolean
  connecting: boolean
  secondsLeft: number | null
  /** Small status line under the business name while not on a call —
   *  "ringing…", "training…", or a "ready early" nudge. */
  statusLabel: string
  answerDisabled: boolean
  onAnswer: () => void
  onHangup: () => void
}

export default function PhoneMockup({
  businessName,
  onCall,
  connecting,
  secondsLeft,
  statusLabel,
  answerDisabled,
  onAnswer,
  onHangup,
}: PhoneMockupProps) {
  const initial = businessName.trim().charAt(0).toUpperCase() || 'X'

  return (
    <div className="relative shrink-0">
      {/* Warm glow under the phone */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -bottom-9 w-[210px] h-[70px] rounded-full blur-2xl pointer-events-none"
        style={{ background: 'rgba(232,68,37,0.18)' }}
      />
      <div
        className="relative w-[250px] h-[520px] sm:w-[292px] sm:h-[610px] overflow-hidden rounded-[42px] sm:rounded-[50px]"
        style={{
          background: '#f7f5f3',
          boxShadow:
            '0 0 0 8px var(--surface-secondary), 0 0 0 9px rgba(0,0,0,0.07), 0 40px 100px -20px rgba(28,25,23,0.28), 0 0 60px rgba(232,68,37,0.10), inset 0 0 0 1px rgba(0,0,0,0.1), inset 0 2px 0 0 rgba(255,255,255,0.8)',
        }}
      >
        <div
          className="absolute inset-0"
          style={{ backgroundImage: 'linear-gradient(175deg, #faf8f6 0%, #f3ede8 55%, #f9f7f5 100%)' }}
        />

        {/* Dynamic-island style status pill */}
        <div className="absolute left-1/2 -translate-x-1/2 top-3 sm:top-3.5 w-[100px] sm:w-[120px] h-[28px] sm:h-[34px] rounded-full bg-[#1a1714] flex items-center justify-center gap-2 z-10">
          <span className="w-2.5 h-2.5 rounded-full bg-[#2a2522] border-2 border-[#333]" />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'rgba(24,139,66,0.5)', border: '1px solid rgba(24,139,66,0.7)' }} />
        </div>

        {!onCall ? (
          // ═══ INCOMING CALL ═══
          <div className="relative h-full flex flex-col items-center px-5 sm:px-6 pt-14 sm:pt-[68px] pb-8 sm:pb-10">
            <p className="w-full text-[11px] sm:text-[13px] tracking-[0.04em]" style={{ color: 'var(--text-tertiary)' }}>
              9:41
            </p>
            <p className="w-full mt-3 sm:mt-3.5 text-[10px] sm:text-[11px] font-bold tracking-[0.15em] uppercase" style={{ color: 'var(--text-tertiary)' }}>
              Incoming Call
            </p>
            <div
              className="mt-3 sm:mt-3.5 w-[76px] h-[52px] sm:w-[90px] sm:h-[60px] rounded-[32px] sm:rounded-[38px] flex items-center justify-center relative"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--accent-primary) 0%, #f95f06 100%)' }}
            >
              <span
                className="absolute inset-0 rounded-[32px] sm:rounded-[38px] pointer-events-none"
                style={{ boxShadow: '0 0 0 10px rgba(232,68,37,0.08), 0 0 0 20px rgba(232,68,37,0.04)' }}
              />
              <span className="text-xl sm:text-2xl font-black text-white">{initial}</span>
            </div>
            <h3 className="mt-3 sm:mt-3.5 text-xl sm:text-2xl font-bold text-center" style={{ color: 'var(--text-primary)' }}>
              {businessName}
            </h3>
            <p className="mt-1 text-[11px] sm:text-xs" style={{ color: 'var(--text-tertiary)' }}>
              AI Receptionist · Active
            </p>
            <div className="flex-1" />
            <p className="mb-5 sm:mb-7 text-[10px] sm:text-[11px] tracking-[0.06em]" style={{ color: 'var(--text-tertiary)' }}>
              {statusLabel}
              <RingDots />
            </p>
            <div className="flex gap-3 sm:gap-5 mb-6 sm:mb-7">
              {[
                { label: 'Silence', Icon: MuteIcon },
                { label: 'Message', Icon: MessageIcon },
                { label: 'Remind', Icon: RemindIcon },
              ].map(({ label, Icon }) => (
                <div
                  key={label}
                  className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl border flex flex-col items-center justify-center gap-0.5"
                  style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  <Icon />
                  <span className="text-[8px] sm:text-[9px]">{label}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-10 sm:gap-[52px]">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  aria-hidden
                  className="w-[58px] h-[58px] sm:w-[68px] sm:h-[68px] rounded-full flex items-center justify-center bg-[#e31c1c] select-none"
                  style={{ boxShadow: '0 6px 10px rgba(227,28,28,0.35)' }}
                >
                  <DeclineIcon />
                </div>
                <span className="text-[9px] sm:text-[10px] tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                  Decline
                </span>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <div className="relative">
                  {!answerDisabled && (
                    <>
                      <span className="absolute inset-0 rounded-full bg-[#188b42] opacity-30 animate-ping" />
                      <span className="absolute inset-0 rounded-full bg-[#188b42] opacity-20 animate-ping" style={{ animationDelay: '450ms' }} />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={onAnswer}
                    disabled={answerDisabled}
                    aria-label="Answer the call"
                    className={`relative w-[58px] h-[58px] sm:w-[68px] sm:h-[68px] rounded-full flex items-center justify-center bg-[#188b42] transition disabled:opacity-50 disabled:cursor-not-allowed ${answerDisabled ? '' : 'xv-phone-wiggle hover:scale-105'}`}
                    style={{ boxShadow: '0 6px 10px rgba(24,139,66,0.35)' }}
                  >
                    <AnswerIcon />
                  </button>
                </div>
                <span className="text-[9px] sm:text-[10px] tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                  Answer
                </span>
              </div>
            </div>
            <p className="mt-3 sm:mt-4 text-[10px] sm:text-[11px] opacity-55 text-center" style={{ color: 'var(--text-tertiary)' }}>
              Tap Answer · No download needed
            </p>
          </div>
        ) : (
          // ═══ ACTIVE CALL ═══
          <div className="relative h-full flex flex-col items-center px-5 pt-14 sm:pt-[68px] pb-8 sm:pb-9">
            <p className="text-xs font-bold tracking-[0.1em]" style={{ color: '#188b42' }}>
              {connecting ? '···' : formatTime(secondsLeft)}
            </p>
            <div
              className="mt-4 sm:mt-5 w-[64px] h-[64px] sm:w-[76px] sm:h-[76px] rounded-full flex items-center justify-center"
              style={{ backgroundImage: 'linear-gradient(135deg, var(--accent-primary) 0%, #f95f06 100%)' }}
            >
              <ActiveCallIcon />
            </div>
            <h3 className="mt-3 sm:mt-4 text-lg sm:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {businessName}
            </h3>
            <p className="mt-1.5 text-[11px] sm:text-xs font-semibold" style={{ color: 'var(--accent-primary)' }}>
              {connecting ? 'Connecting…' : 'AI Receptionist is speaking…'}
            </p>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onHangup}
              aria-label="End call"
              className="w-14 h-14 rounded-full flex items-center justify-center bg-[#e31c1c] hover:scale-105 transition"
              style={{ boxShadow: '0 6px 10px rgba(227,28,28,0.35)' }}
            >
              <DeclineIcon />
            </button>
            <p className="mt-2 text-[10px] sm:text-[11px] opacity-70" style={{ color: 'var(--text-tertiary)' }}>
              Tap to end
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
