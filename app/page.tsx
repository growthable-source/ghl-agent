import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

/* ─── Icons ─── */
function PhoneIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  )
}

function MessageIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  )
}

function CalendarIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function BoltIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}

function CrmIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}

function ChartIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

function WaveformIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  )
}

function CheckIcon({ className = 'w-4 h-4', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}

function ArrowIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  )
}

function ChevronIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

/* ─── FAQ Accordion (client island) ─── */
function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[#121a2b] last:border-0">
      <summary className="flex items-center justify-between cursor-pointer py-5 text-[#f8fafc] font-semibold text-[0.9375rem] list-none [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronIcon className="w-4 h-4 text-[#94a3b8] transition-transform group-open:rotate-180" />
      </summary>
      <p className="pb-5 text-[#94a3b8] text-[0.9375rem] leading-[1.65]">{a}</p>
    </details>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-hidden" style={{ background: '#05080f', color: '#f8fafc' }}>

      {/* ═══ Sticky Nav ═══ */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl border-b" style={{ background: 'rgba(5,8,15,0.92)', borderColor: 'rgba(18,26,43,0.8)' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center">
            <VoxilityLogo height={28} />
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Features</a>
            <a href="#how-it-works" className="text-sm font-medium transition-colors hover:text-white" style={{ color: '#94a3b8' }}>How it works</a>
            <a href="#use-cases" className="text-sm font-medium transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Use cases</a>
            <a href="#faq" className="text-sm font-medium transition-colors hover:text-white" style={{ color: '#94a3b8' }}>FAQ</a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Log in</Link>
            <Link href="/login" className="btn-primary text-sm py-2 px-5">Get started</Link>
          </div>
        </div>
      </nav>

      {/* ═══ Hero ═══ */}
      <section className="relative pt-24 pb-20" style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        {/* Glow */}
        <div className="hero-glow glow-pulse" />

        <div className="relative z-10 max-w-[1280px] mx-auto px-6 text-center">
          <span className="section-label inline-block mb-6">Conversational AI Platform</span>

          <h1 className="font-extrabold tracking-tight leading-[1.1] mb-6" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)' }}>
            Your phone rings.<br />
            <span className="text-gradient">AI picks up.</span>
          </h1>

          <p className="max-w-2xl mx-auto mb-10 leading-[1.7]" style={{ color: '#94a3b8', fontSize: '1.125rem' }}>
            Voxility agents answer calls, respond to texts, qualify leads, book appointments, and follow up — without you touching a thing. Plug into GoHighLevel or HubSpot. Go live in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login" className="btn-primary">
              Start building free
              <ArrowIcon />
            </Link>
            <a href="#how-it-works" className="btn-secondary">
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ═══ Live conversation mockup ═══ */}
      <section className="max-w-4xl mx-auto px-6 pb-24">
        <div className="vox-card overflow-hidden" style={{ boxShadow: '0 4px 40px rgba(0,0,0,0.4)' }}>
          {/* Header bar */}
          <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: '#121a2b' }}>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: '#1a2540' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#1a2540' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: '#1a2540' }} />
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: '#64748b' }}>
              <WaveformIcon className="w-4 h-4" />
              <span>Live call — Sarah (Inbound)</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#16a249' }} />
              <span className="text-xs" style={{ color: '#16a249' }}>Recording</span>
            </div>
          </div>

          {/* Transcript */}
          <div className="p-6 space-y-5 text-sm" style={{ fontFamily: 'var(--font-dm-mono), monospace' }}>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: '#60a5fa' }}>Caller</span>
              <span style={{ color: '#94a3b8' }}>Hi, I saw your ad about the kitchen remodel special. Is that still going on?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: '#fa4d2e' }}>Agent</span>
              <span style={{ color: '#f8fafc' }}>Absolutely! The spring special runs through April. We&apos;re offering 15% off full kitchen remodels. Can I ask a few quick questions to see how we can help?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: '#60a5fa' }}>Caller</span>
              <span style={{ color: '#94a3b8' }}>Sure, go ahead.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: '#fa4d2e' }}>Agent</span>
              <span style={{ color: '#f8fafc' }}>Great. What&apos;s your timeline looking like — are you hoping to start in the next month or two?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: '#60a5fa' }}>Caller</span>
              <span style={{ color: '#94a3b8' }}>Yeah, ideally next month. We already have a design in mind.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: '#fa4d2e' }}>Agent</span>
              <span style={{ color: '#f8fafc' }}>
                Perfect. I have availability this Thursday at 2 PM or Friday at 10 AM for a consultation. Which works better?
              </span>
            </div>

            {/* Tool call indicator */}
            <div className="ml-[76px] pl-4" style={{ borderLeft: '2px solid rgba(250,77,46,0.3)' }}>
              <div className="inline-flex items-center gap-2 text-xs rounded-md px-3 py-1.5" style={{ color: 'rgba(250,77,46,0.8)', background: 'rgba(250,77,46,0.08)' }}>
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>book_appointment — Thursday 2:00 PM</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Stats bar ═══ */}
      <section className="border-y py-16 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: '100+', label: 'AI voices available' },
            { value: '7', label: 'Messaging channels' },
            { value: '20+', label: 'Built-in AI tools' },
            { value: '<5 min', label: 'Setup time' },
          ].map((s) => (
            <div key={s.label}>
              <div className="stat-value mb-2">{s.value}</div>
              <div className="text-xs font-medium" style={{ color: '#64748b' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">Features</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Everything the agent does</h2>
            <p style={{ color: '#94a3b8', fontSize: '1.125rem' }}>One platform replacing a team of SDRs, receptionists, and follow-up assistants.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Voice AI */}
            <div className="vox-card p-7">
              <div className="icon-box mb-5">
                <PhoneIcon />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>Voice AI</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: '#94a3b8' }}>
                Answers inbound calls and makes outbound calls through GHL workflows. Handles objections, qualifies, and books — on the phone.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: '#94a3b8' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />100+ ElevenLabs voice options</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Test calls in the browser</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Full transcript + recording</li>
              </ul>
            </div>

            {/* Multi-channel */}
            <div className="vox-card p-7">
              <div className="icon-box mb-5">
                <MessageIcon />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>Multi-channel messaging</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: '#94a3b8' }}>
                SMS, email, Instagram, Facebook, Google Business, WhatsApp, and live chat. One agent brain handles all of them with full conversation memory.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: '#94a3b8' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />7 channels, single agent</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Conversations sync to CRM</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Auto follow-ups + drips</li>
              </ul>
            </div>

            {/* Lead qualification */}
            <div className="vox-card p-7">
              <div className="icon-box mb-5">
                <ChartIcon />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>Lead qualification + scoring</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: '#94a3b8' }}>
                Define qualifying questions the agent asks every caller or texter. Answers map to scores. Hot leads get tagged, moved through pipelines, and flagged.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: '#94a3b8' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Custom questions per agent</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Automatic scoring + tagging</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Pipeline stage changes</li>
              </ul>
            </div>

            {/* Booking */}
            <div className="vox-card p-7">
              <div className="icon-box mb-5">
                <CalendarIcon />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>Appointment booking</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: '#94a3b8' }}>
                Checks real-time availability and books mid-conversation. Works with your CRM calendar. Sends confirmation and reminders automatically.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: '#94a3b8' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Live availability checking</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Books during calls or texts</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: '#16a249' }} />Timezone-aware scheduling</li>
              </ul>
            </div>

            {/* CRM */}
            <div className="vox-card p-7">
              <div className="icon-box mb-5">
                <CrmIcon />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>Deep CRM integration</h3>
              <p className="text-[0.9375rem] leading-[1.65]" style={{ color: '#94a3b8' }}>
                Agents read and write CRM data natively. Tag contacts, update custom fields, move pipeline stages, send follow-ups, and log every interaction. GoHighLevel and HubSpot supported.
              </p>
            </div>

            {/* AI Tools */}
            <div className="vox-card p-7">
              <div className="icon-box mb-5">
                <BoltIcon />
              </div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>20+ AI-powered tools</h3>
              <p className="text-[0.9375rem] leading-[1.65]" style={{ color: '#94a3b8' }}>
                Agents don&apos;t just talk — they act. Book appointments, check availability, tag contacts, send SMS, query knowledge bases, update pipelines, and trigger workflows. All mid-conversation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Orange divider ═══ */}
      <div className="max-w-[1280px] mx-auto px-6"><hr className="orange-rule" /></div>

      {/* ═══ How it works ═══ */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">How It Works</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Three steps. That&apos;s it.</h2>
            <p style={{ color: '#94a3b8', fontSize: '1.125rem' }}>No developers needed. No month-long setup.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                title: 'Connect your CRM',
                desc: 'Install from the GoHighLevel marketplace or connect HubSpot. Your contacts, pipelines, and calendars sync automatically.',
              },
              {
                step: '02',
                title: 'Build your agent',
                desc: 'Give it a persona, knowledge base, and qualifying questions. Pick a voice. Set the rules for how it handles calls and texts.',
              },
              {
                step: '03',
                title: 'Go live',
                desc: 'Assign a phone number and flip it on. Inbound calls get answered. Leads get qualified. Appointments get booked. You get notified.',
              },
            ].map((item) => (
              <div key={item.step} className="vox-card p-7">
                <div className="stat-value mb-4" style={{ fontSize: '2rem' }}>{item.step}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: '#f8fafc' }}>{item.title}</h3>
                <p className="text-[0.9375rem] leading-[1.65]" style={{ color: '#94a3b8' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ The difference (full-width card) ═══ */}
      <section className="py-8 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="vox-card p-10 md:p-16" style={{ background: 'linear-gradient(135deg, #090d15 0%, #0f1524 100%)' }}>
            <div className="max-w-3xl">
              <span className="section-label inline-block mb-4">Why Voxility</span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6" style={{ color: '#f8fafc' }}>
                This isn&apos;t a chatbot with a phone number.
              </h2>
              <div className="space-y-4 text-[0.9375rem] leading-[1.65]" style={{ color: '#94a3b8' }}>
                <p>
                  Most &quot;AI voice&quot; products give you a script reader that falls apart the moment someone asks a real question. Voxility agents are different.
                </p>
                <p>
                  They know your business because you teach them — with a knowledge base, qualifying questions, and a persona that matches your brand. They have tools to actually do things: check calendars, book appointments, tag leads, send texts.
                </p>
                <p>
                  They run inside your existing CRM workflows. Not beside them. Not on top of them. <span className="font-semibold" style={{ color: '#f8fafc' }}>Inside.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Mid-page CTA strip ═══ */}
      <section className="py-20 px-6 relative">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(250,77,46,0.06), transparent 70%)' }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">Ready to stop missing calls?</h2>
          <p className="mb-8 text-[0.9375rem]" style={{ color: '#94a3b8' }}>Create your first AI agent in under 5 minutes. Free while in beta.</p>
          <Link href="/login" className="btn-primary">
            Start building free
            <ArrowIcon />
          </Link>
        </div>
      </section>

      {/* ═══ Use cases ═══ */}
      <section id="use-cases" className="py-24 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">Use Cases</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Built for businesses that live on the phone</h2>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { title: 'Home services', desc: 'HVAC, plumbing, roofing, remodeling. Qualify jobs, book estimates, follow up on quotes — without office staff.' },
              { title: 'Real estate', desc: 'Answer property inquiries 24/7. Qualify buyers, schedule showings, and push hot leads to the top of your pipeline.' },
              { title: 'Healthcare', desc: 'Patient intake, appointment scheduling, and follow-up reminders. Reduce no-shows without adding front desk staff.' },
              { title: 'Legal', desc: 'Screen potential clients, gather case details, and book consultations. Route qualified leads to the right attorney.' },
              { title: 'Agencies', desc: 'White-label for your clients. Each sub-account gets its own agent, persona, and phone number. Scale without headcount.' },
              { title: 'Auto & dealerships', desc: 'Service booking, test drive scheduling, and lead follow-up. Handle the call volume that kills conversion rates.' },
            ].map((uc) => (
              <div key={uc.title} className="vox-card p-7">
                <h3 className="text-[0.9375rem] font-semibold mb-2" style={{ color: '#f8fafc' }}>{uc.title}</h3>
                <p className="text-sm leading-[1.65]" style={{ color: '#94a3b8' }}>{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Orange divider ═══ */}
      <div className="max-w-[1280px] mx-auto px-6"><hr className="orange-rule" /></div>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <span className="section-label inline-block mb-4">FAQ</span>
            <h2 className="text-3xl font-bold tracking-tight">Common questions</h2>
          </div>

          <div className="vox-card p-6 md:p-8">
            <FAQItem
              q="Do I need to be technical to use Voxility?"
              a="No. If you can fill out a form, you can build an agent. Pick a voice, write some instructions in plain English, add your qualifying questions, and go live. No code, no API keys, no developers."
            />
            <FAQItem
              q="What CRMs does Voxility work with?"
              a="GoHighLevel (via the GHL Marketplace) and HubSpot. We sync contacts, pipelines, calendars, and conversations. Your agent reads and writes CRM data natively — no Zapier glue required."
            />
            <FAQItem
              q="How realistic do the voice calls sound?"
              a="Very. We use ElevenLabs with 100+ voice options. You can tune speed, tone, and personality. Most callers don't realize they're talking to an AI until you tell them."
            />
            <FAQItem
              q="Can the AI actually book appointments?"
              a="Yes. It checks your real-time calendar availability and books directly during the call or text conversation. Confirmation and reminders are sent automatically."
            />
            <FAQItem
              q="What happens if the AI can't handle a question?"
              a="You configure fallback behavior — it can transfer to a human, take a message, or offer to call back. You set the rules, and the agent follows them."
            />
            <FAQItem
              q="How much does it cost?"
              a="Voxility is free during the beta. We'll introduce pricing as we exit beta, with plans designed for agencies and SMBs."
            />
          </div>
        </div>
      </section>

      {/* ═══ Final CTA ═══ */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 40%, rgba(250,77,46,0.1), transparent 60%)' }} />
        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <span className="section-label inline-block mb-4">Get Started</span>
          <h2 className="font-bold tracking-tight mb-6" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}>
            Stop missing calls.<br />
            <span className="text-gradient">Start closing them.</span>
          </h2>
          <p className="mb-10 text-[1.125rem] leading-[1.7]" style={{ color: '#94a3b8' }}>
            Build your first AI agent in under 5 minutes. Free while in beta.
          </p>
          <Link href="/login" className="btn-primary text-base py-3 px-8">
            Get started free
            <ArrowIcon />
          </Link>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <VoxilityLogo height={16} />
          <div className="flex items-center gap-6">
            <a href="https://voxility.canny.io" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Feedback</a>
            <Link href="/login" className="hover:text-white transition-colors">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
