import Link from 'next/link'

function PhoneIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}

function CrmIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}

function WaveformIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  )
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {/* ─── Nav ─── */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-sm font-bold">V</div>
          <span className="text-lg font-semibold tracking-tight">Voxility AI</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors">Log in</Link>
          <Link href="/login" className="text-sm bg-white text-black font-medium px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors">Get started</Link>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative max-w-5xl mx-auto text-center pt-20 pb-32 px-6">
        {/* Ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-blue-600/15 via-violet-600/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 text-sm text-emerald-400 font-medium mb-8 bg-emerald-950/40 border border-emerald-900/50 rounded-full px-4 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Now in beta
          </div>

          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-8">
            Your phone rings.<br />
            <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">AI picks up.</span>
          </h1>

          <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            Voxility agents answer calls, respond to texts, qualify leads, book appointments, and follow up — all without you touching a thing. Plug into GoHighLevel or HubSpot. Go live in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/login" className="group bg-white text-black font-semibold text-sm h-12 px-8 rounded-xl hover:bg-zinc-200 transition-all inline-flex items-center justify-center gap-2">
              Start building free
              <ArrowIcon />
            </Link>
            <a href="#how-it-works" className="border border-zinc-700 text-zinc-300 font-medium text-sm h-12 px-8 rounded-xl hover:border-zinc-500 hover:text-white transition-all inline-flex items-center justify-center">
              See how it works
            </a>
          </div>
        </div>
      </section>

      {/* ─── Live conversation mockup ─── */}
      <section className="max-w-4xl mx-auto px-6 pb-32">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 backdrop-blur-sm overflow-hidden shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-zinc-800/80">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-zinc-800" />
              <div className="w-3 h-3 rounded-full bg-zinc-800" />
              <div className="w-3 h-3 rounded-full bg-zinc-800" />
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <WaveformIcon />
              <span>Live call — Sarah (Inbound)</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-emerald-400">Recording</span>
            </div>
          </div>

          {/* Transcript */}
          <div className="p-6 space-y-5 font-mono text-sm">
            <div className="flex gap-3">
              <span className="shrink-0 text-blue-400/80 w-16 text-right">Caller</span>
              <span className="text-zinc-300">Hi, I saw your ad about the kitchen remodel special. Is that still going on?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 text-violet-400/80 w-16 text-right">Agent</span>
              <span className="text-zinc-300">Absolutely! The spring special runs through April. We&apos;re offering 15% off full kitchen remodels. Can I ask a few quick questions to see how we can help?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 text-blue-400/80 w-16 text-right">Caller</span>
              <span className="text-zinc-300">Sure, go ahead.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 text-violet-400/80 w-16 text-right">Agent</span>
              <span className="text-zinc-300">Great. What&apos;s your timeline looking like — are you hoping to start in the next month or two?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 text-blue-400/80 w-16 text-right">Caller</span>
              <span className="text-zinc-300">Yeah, ideally next month. We already have a design in mind.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 text-violet-400/80 w-16 text-right">Agent</span>
              <span className="text-zinc-300">
                Perfect, sounds like you&apos;re ready to go. I have availability this Thursday at 2 PM or Friday at 10 AM for a consultation. Which works better?
              </span>
            </div>

            {/* Tool call */}
            <div className="ml-19 pl-4 border-l-2 border-violet-500/30">
              <div className="inline-flex items-center gap-2 text-xs text-violet-400/70 bg-violet-500/10 rounded-md px-3 py-1.5">
                <CalendarIcon />
                <span>book_appointment — Thursday 2:00 PM</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How it works ─── */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Three steps. That&apos;s it.</h2>
          <p className="text-zinc-500 text-lg">No developers needed. No month-long setup.</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="relative">
            <div className="text-6xl font-bold text-zinc-900 mb-4">01</div>
            <h3 className="text-lg font-semibold mb-2">Connect your CRM</h3>
            <p className="text-zinc-500 leading-relaxed">
              Install from the GoHighLevel marketplace or connect HubSpot. Your contacts, pipelines, and calendars sync automatically.
            </p>
          </div>
          <div className="relative">
            <div className="text-6xl font-bold text-zinc-900 mb-4">02</div>
            <h3 className="text-lg font-semibold mb-2">Build your agent</h3>
            <p className="text-zinc-500 leading-relaxed">
              Give it a persona, knowledge base, and qualifying questions. Pick a voice. Set the rules for how it handles calls and texts.
            </p>
          </div>
          <div className="relative">
            <div className="text-6xl font-bold text-zinc-900 mb-4">03</div>
            <h3 className="text-lg font-semibold mb-2">Go live</h3>
            <p className="text-zinc-500 leading-relaxed">
              Assign a phone number and flip it on. Inbound calls get answered. Leads get qualified. Appointments get booked. You get notified.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Capabilities ─── */}
      <section className="max-w-5xl mx-auto px-6 pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Everything the agent does</h2>
          <p className="text-zinc-500 text-lg">One platform replacing a team of SDRs, receptionists, and follow-up assistants.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Voice */}
          <div className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 hover:border-zinc-700 transition-colors">
            <div className="w-11 h-11 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 mb-5">
              <PhoneIcon />
            </div>
            <h3 className="text-lg font-semibold mb-2">Voice AI</h3>
            <p className="text-zinc-500 leading-relaxed mb-4">
              Answers inbound calls with natural-sounding voices. Makes outbound calls through GHL workflows. Handles objections, qualifies, and books — on the phone.
            </p>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-blue-400" />100+ voice options from ElevenLabs</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-blue-400" />Test calls directly in the browser</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-blue-400" />Full transcript + recording for every call</li>
            </ul>
          </div>

          {/* Messaging */}
          <div className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 hover:border-zinc-700 transition-colors">
            <div className="w-11 h-11 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 mb-5">
              <MessageIcon />
            </div>
            <h3 className="text-lg font-semibold mb-2">Multi-channel messaging</h3>
            <p className="text-zinc-500 leading-relaxed mb-4">
              SMS, email, Instagram, Facebook, Google Business Chat, WhatsApp, and live chat. One agent handles them all with full conversation memory.
            </p>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-violet-400" />7 channels, single agent brain</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-violet-400" />Conversations sync to your CRM</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-violet-400" />Auto follow-ups + drip sequences</li>
            </ul>
          </div>

          {/* Qualifying */}
          <div className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 hover:border-zinc-700 transition-colors">
            <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-5">
              <ChartIcon />
            </div>
            <h3 className="text-lg font-semibold mb-2">Lead qualification + scoring</h3>
            <p className="text-zinc-500 leading-relaxed mb-4">
              Define qualifying questions your agent asks every caller or texter. Answers map to scores. Hot leads get tagged, moved through pipelines, and flagged immediately.
            </p>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-amber-400" />Custom questions per agent</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-amber-400" />Automatic lead scoring + tagging</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-amber-400" />Pipeline stage changes on qualification</li>
            </ul>
          </div>

          {/* Booking */}
          <div className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 hover:border-zinc-700 transition-colors">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-5">
              <CalendarIcon />
            </div>
            <h3 className="text-lg font-semibold mb-2">Appointment booking</h3>
            <p className="text-zinc-500 leading-relaxed mb-4">
              Checks real-time availability and books appointments mid-conversation. Works with your CRM calendar. Sends confirmation and reminders automatically.
            </p>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-400" />Live availability checking</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-400" />Books during calls or text conversations</li>
              <li className="flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-emerald-400" />Timezone-aware scheduling</li>
            </ul>
          </div>
        </div>

        {/* Second row — wider cards */}
        <div className="grid md:grid-cols-2 gap-5 mt-5">
          {/* CRM */}
          <div className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 hover:border-zinc-700 transition-colors">
            <div className="w-11 h-11 rounded-xl bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center text-zinc-400 mb-5">
              <CrmIcon />
            </div>
            <h3 className="text-lg font-semibold mb-2">Deep CRM integration</h3>
            <p className="text-zinc-500 leading-relaxed">
              Not just a connection — agents read and write CRM data natively. Tag contacts, update custom fields, move pipeline stages, send SMS follow-ups, and log every interaction. GoHighLevel and HubSpot supported today.
            </p>
          </div>

          {/* AI Tools */}
          <div className="group rounded-2xl border border-zinc-800 bg-zinc-950/60 p-8 hover:border-zinc-700 transition-colors">
            <div className="w-11 h-11 rounded-xl bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center text-zinc-400 mb-5">
              <BoltIcon />
            </div>
            <h3 className="text-lg font-semibold mb-2">20+ AI-powered tools</h3>
            <p className="text-zinc-500 leading-relaxed">
              Agents don&apos;t just talk — they act. Book appointments, check availability, tag contacts, send follow-up SMS, look up knowledge base entries, update pipelines, and trigger workflows. All mid-conversation.
            </p>
          </div>
        </div>
      </section>

      {/* ─── The difference ─── */}
      <section className="max-w-5xl mx-auto px-6 pb-32">
        <div className="rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900/50 p-10 md:p-16">
          <div className="max-w-3xl">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
              This isn&apos;t a chatbot with a phone number.
            </h2>
            <div className="space-y-4 text-zinc-400 text-lg leading-relaxed">
              <p>
                Most &quot;AI voice&quot; products give you a script reader that falls apart the moment someone asks a real question. Voxility agents are different.
              </p>
              <p>
                They know your business because you teach them — with a knowledge base, qualifying questions, and a persona that matches your brand. They have tools to actually do things: check calendars, book appointments, tag leads, send texts.
              </p>
              <p>
                They run inside your existing CRM workflows. Not beside them. Not on top of them. Inside.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Use cases ─── */}
      <section className="max-w-5xl mx-auto px-6 pb-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Built for businesses that live on the phone</h2>
        </div>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-5">
          {[
            { title: 'Home services', desc: 'HVAC, plumbing, roofing, remodeling. Qualify jobs, book estimates, follow up on quotes — without office staff.' },
            { title: 'Real estate', desc: 'Answer property inquiries 24/7. Qualify buyers, schedule showings, and push hot leads to the top of your pipeline.' },
            { title: 'Healthcare', desc: 'Patient intake, appointment scheduling, and follow-up reminders. Reduce no-shows without adding front desk staff.' },
            { title: 'Legal', desc: 'Screen potential clients, gather case details, and book consultations. Route qualified leads to the right attorney.' },
            { title: 'Agencies', desc: 'White-label for your clients. Each sub-account gets its own agent, persona, and phone number. Scale without headcount.' },
            { title: 'Auto & dealerships', desc: 'Service appointment booking, test drive scheduling, and lead follow-up. Handle the call volume that kills conversion rates.' },
          ].map((uc) => (
            <div key={uc.title} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6 hover:border-zinc-700 transition-colors">
              <h3 className="text-sm font-semibold text-zinc-200 mb-2">{uc.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{uc.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="relative py-32 px-6">
        {/* Background glow */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[500px] h-[300px] bg-gradient-to-b from-violet-600/10 via-blue-600/10 to-transparent rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Stop missing calls.<br />Start closing them.
          </h2>
          <p className="text-zinc-400 text-lg mb-10">
            Build your first AI agent in under 5 minutes. Free while in beta.
          </p>
          <Link href="/login" className="group bg-white text-black font-semibold text-sm h-12 px-8 rounded-xl hover:bg-zinc-200 transition-all inline-flex items-center justify-center gap-2">
            Get started free
            <ArrowIcon />
          </Link>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-zinc-900 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <div className="flex items-center gap-2.5">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-[10px] font-bold">V</div>
            <span>Voxility AI</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://voxility.canny.io" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-400 transition-colors">Feedback</a>
            <Link href="/login" className="hover:text-zinc-400 transition-colors">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
