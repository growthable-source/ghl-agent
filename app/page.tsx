import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-sm font-bold">V</div>
          <span className="text-lg font-semibold">Voxility AI</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors">Log in</Link>
          <Link href="/login" className="text-sm bg-white text-black font-medium px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors">Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center pt-24 pb-20 px-6">
        <div className="inline-flex items-center gap-2 text-sm text-emerald-400 font-medium mb-6 bg-emerald-950/40 border border-emerald-900/50 rounded-full px-4 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Now in beta
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
          AI agents that talk,<br />text, and close deals
        </h1>
        <p className="text-lg text-zinc-400 max-w-2xl mx-auto mb-10">
          Build conversational AI agents that handle inbound calls, respond to SMS, qualify leads, book appointments, and follow up automatically. Connect your CRM, calendar, and phone — all from one platform.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link href="/login" className="bg-white text-black font-medium text-sm h-11 px-6 rounded-lg hover:bg-zinc-200 transition-colors inline-flex items-center justify-center">
            Start building free
          </Link>
          <a href="#features" className="border border-zinc-700 text-zinc-300 font-medium text-sm h-11 px-6 rounded-lg hover:border-zinc-500 hover:text-white transition-colors inline-flex items-center justify-center">
            See how it works
          </a>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-5xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            {
              title: 'Voice AI',
              desc: 'Inbound call handling with natural voices. Browse and preview voices, tune speed and tone, test calls live in the browser.',
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              ),
            },
            {
              title: 'SMS Agents',
              desc: 'AI-powered SMS responses with full conversation memory. Qualifies leads, answers questions, and follows up on autopilot.',
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
                </svg>
              ),
            },
            {
              title: 'Smart Booking',
              desc: 'Connects to Calendly, Cal.com, or your CRM calendar. Agents check availability and book appointments mid-conversation.',
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              ),
            },
            {
              title: 'Lead Scoring',
              desc: 'AI scores every lead based on conversation signals. Know who is hot, warm, or cold without lifting a finger.',
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              ),
            },
            {
              title: 'Follow-up Sequences',
              desc: 'Automated SMS drips triggered after calls or conversations. Re-engage leads that went cold.',
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" />
                </svg>
              ),
            },
            {
              title: 'Multi-CRM',
              desc: 'Works with GoHighLevel, HubSpot, and more. Connect your existing CRM and the agent uses it natively.',
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              ),
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
              <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-400 mb-4">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-zinc-200 mb-2">{f.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-zinc-900 py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to automate your conversations?</h2>
          <p className="text-zinc-400 mb-8">Create your first AI agent in under 5 minutes. No credit card required.</p>
          <Link href="/login" className="bg-white text-black font-medium text-sm h-11 px-8 rounded-lg hover:bg-zinc-200 transition-colors inline-flex items-center justify-center">
            Get started free
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8 px-6">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-zinc-600">
          <span>Voxility AI</span>
          <span>Built with Claude</span>
        </div>
      </footer>
    </div>
  )
}
