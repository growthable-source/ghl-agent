const STEPS = [
  { n: '1', title: 'Paste your website', body: 'We scan your site and extract your hours, services, FAQs, pricing, and brand voice automatically.' },
  { n: '2', title: 'AI gets trained', body: 'Your AI receptionist is built and tested — tuned to sound like a natural extension of your team.' },
  { n: '3', title: 'Your phone gets answered', body: 'Forward your number. Every call handled instantly, 24/7. Summaries hit your inbox after each one.' },
]

export default function Process() {
  return (
    <section id="how-it-works" className="py-16 sm:py-24 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-14 sm:mb-16">
          <span className="section-label inline-block mb-4">The process</span>
          <h2 className="font-black tracking-tight mb-4" style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', color: 'var(--text-primary)' }}>
            Live in under 2 minutes.
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>No developers. No long contracts. Just a smarter phone.</p>
        </div>

        <div className="relative grid sm:grid-cols-3 gap-10 sm:gap-6">
          <div
            className="hidden sm:block absolute left-[16.6%] right-[16.6%] top-[39px] h-px"
            style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(232,68,37,0.4) 25%, rgba(249,95,6,0.3) 50%, rgba(232,68,37,0.4) 75%, transparent 100%)' }}
          />
          {STEPS.map(s => (
            <div key={s.n} className="flex flex-col items-center text-center px-4">
              <div className="vox-card w-[78px] h-[78px] rounded-full flex items-center justify-center relative z-10 mb-4">
                <span className="font-black text-xl" style={{ color: 'var(--accent-primary)' }}>{s.n}</span>
              </div>
              <h3 className="font-bold text-[19px] mb-2" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
              <p className="text-sm leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
