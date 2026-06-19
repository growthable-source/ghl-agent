import type { Metadata } from 'next'
import Link from 'next/link'
import Script from 'next/script'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import DemoModal from '@/components/landing/DemoModal'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

export const metadata: Metadata = {
  title: 'AI for Med Spas & Aesthetic Clinics — Never Miss a Consult | Voxility',
  description:
    'Voxility helps med spas, aesthetic and health clinics across the US & Canada book more consults: instant speed-to-lead, ad automation that turns clicks into booked consultations, and a voice AI agent that answers every call 24/7. Fill your calendar, lose fewer leads.',
  alternates: { canonical: `${SITE_URL}/ai-for-med-spas` },
  openGraph: {
    title: 'AI for Med Spas & Aesthetic Clinics — Never Miss a Consult',
    description:
      'Instant speed-to-lead, ad automation, and a 24/7 voice AI receptionist — built for med spas and aesthetic clinics in the US & Canada.',
    url: `${SITE_URL}/ai-for-med-spas`,
    type: 'website',
  },
}

const PIXEL_ID = '1285462570417058'

// Niche copy for the shared demo modal so it reads "med spa / clinic".
const DEMO_COPY = {
  heading: 'Book your med spa demo',
  orgLabel: 'Clinic / practice name',
  orgPlaceholder: 'Glow Aesthetics',
  emailPlaceholder: 'alex@yourclinic.com',
}

// Three pillars, med-spa framed. Each maps to a real Voxility capability.
const PILLARS: { eyebrow: string; title: string; body: string; icon: React.ReactNode }[] = [
  {
    eyebrow: 'Speed to lead',
    title: 'Reply in seconds, not hours',
    body: 'Aesthetic leads go cold fast — they’re price-shopping Botox and fillers across three clinics. The moment someone fills a form, DMs you, or calls and you miss it, Voxility texts and calls back automatically, answers their question, and books the consult before a competitor does.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    eyebrow: 'Ad automation',
    title: 'Turn ad spend into booked consults',
    body: 'Med spas live on Meta and Google ads. Connect them and every click that becomes a lead is instantly engaged, qualified, and booked — with the outcome written back to your CRM. See real cost-per-booked-consult and cost-per-treatment, not just cost-per-click.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
      </svg>
    ),
  },
  {
    eyebrow: 'Voice AI agents',
    title: 'An AI receptionist that never misses a call',
    body: 'A natural, human-sounding voice answers every call 24/7 — handles “how much is a syringe of filler?”, books consultations and treatments straight onto your calendar, manages after-hours and overflow, and routes clinical questions to your team. You set exactly what it can and can’t say.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
      </svg>
    ),
  },
]

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Connect your tools', body: 'Link your CRM, calendar, and ad accounts in a few minutes. No developer required.' },
  { n: '2', title: 'Voxility engages every lead', body: 'Web forms, DMs, missed calls, and ad clicks all get an instant, on-brand response by text and voice.' },
  { n: '3', title: 'Consults get booked', body: 'The agent qualifies, answers treatment and pricing questions you approve, and books consultations onto your calendar — then logs it in your CRM.' },
  { n: '4', title: 'You see booked chairs, not clicks', body: 'Every interaction is tracked end-to-end, so you know exactly which ads and channels fill your schedule.' },
]

const FAQS: { q: string; a: string }[] = [
  { q: 'Does it work with my med spa CRM / booking system?', a: 'Yes. Voxility installs from the GoHighLevel Marketplace and connects to HubSpot, and the agent reads and writes your CRM natively — leads, consults, and patients all stay in sync with your calendar.' },
  { q: 'Is it appropriate for a medical / aesthetic practice?', a: 'It handles the front desk — scheduling, FAQs, and lead follow-up. You set the script and guardrails, and it routes anything clinical to your team. It only says what you approve about pricing and treatments; it never invents medical advice.' },
  { q: 'Can it book consultations and treatments?', a: 'Yes — it checks real-time availability and books during the conversation, with automatic confirmations and reminders to cut the no-shows that hurt high-value aesthetic appointments.' },
  { q: 'Does the voice sound like a robot?', a: 'No. It uses natural, human-sounding voices — most callers don’t realize they’re talking to an AI until you tell them.' },
  { q: 'Is this available in the US and Canada?', a: 'Yes — Voxility is built for med spas, aesthetic and health clinics across both the US and Canada, with local phone numbers in both countries.' },
]

export default function MedSpaLandingPage() {
  return (
    <div data-theme="soft-light" className="min-h-screen overflow-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {/* ── Meta Pixel (scoped to this page) ── */}
      <Script id="meta-pixel-medspa" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img height="1" width="1" style={{ display: 'none' }} alt="" src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`} />
      </noscript>

      <MarketingNav />

      {/* ── Hero ── */}
      <section className="relative pt-16 pb-14 px-6 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(232,68,37,0.08), transparent 60%)' }} />
        <div className="relative z-10 max-w-[920px] mx-auto text-center">
          <div className="section-label mb-3">For med spas, aesthetic &amp; health clinics · US &amp; Canada</div>
          <h1 className="text-4xl md:text-[3.25rem] font-extrabold tracking-tight leading-[1.06] mb-5" style={{ color: 'var(--text-primary)' }}>
            Turn every inquiry into a <span className="text-gradient">booked consult</span> — automatically.
          </h1>
          <p className="text-lg leading-[1.6] max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Voxility answers every call, text, and ad inquiry in seconds, 24/7 — qualifies the lead, books the consultation, and follows up — so your front desk never loses a high-value treatment to a faster clinic.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <DemoModal {...DEMO_COPY} triggerLabel="Book a demo" source="medspa_hero" />
              <Link href="/login?mode=signup" className="btn-secondary">Start free</Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Built for clinics across the US &amp; Canada. Free while in beta — no card required.
            </p>
          </div>
        </div>
      </section>

      {/* ── Proof strip ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[900px] mx-auto grid grid-cols-3 gap-6 text-center border-y py-8" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="stat-value mb-2">Seconds</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>To first response on every lead</div>
          </div>
          <div>
            <div className="stat-value mb-2">24/7</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Every call answered, day or night</div>
          </div>
          <div>
            <div className="stat-value mb-2">US + CA</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Local numbers in both countries</div>
          </div>
        </div>
      </section>

      {/* ── Three pillars ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Three ways clinics grow with Voxility
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {PILLARS.map((p) => (
              <div key={p.title} className="vox-card p-7">
                <div className="icon-box mb-5">{p.icon}</div>
                <div className="section-label mb-2">{p.eyebrow}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{p.title}</h3>
                <p className="text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Live in an afternoon</h2>
            <p className="mt-2 text-[0.9375rem]" style={{ color: 'var(--text-secondary)' }}>No new software for your front desk to learn — it works the leads you already get.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="vox-card p-6">
                <div className="text-sm font-bold mb-3" style={{ color: 'var(--accent-primary)' }}>{s.n}</div>
                <h3 className="text-[0.9375rem] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
                <p className="text-[0.875rem] leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA band ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[820px] mx-auto vox-card p-8 md:p-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>
            Stop losing consults to slow follow-up
          </h2>
          <p className="mb-7 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            See exactly how Voxility would work for your clinic — book a quick demo and we&apos;ll show you it answering a lead live.
          </p>
          <div className="flex flex-col items-center gap-3">
            <DemoModal {...DEMO_COPY} triggerLabel="Book your demo" source="medspa_cta" />
            <Link href="/login?mode=signup" className="text-sm underline" style={{ color: 'var(--accent-primary)' }}>
              or start building free →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[760px] mx-auto">
          <h2 className="text-2xl font-bold tracking-tight mb-6 text-center" style={{ color: 'var(--text-primary)' }}>Clinic owner questions</h2>
          <div className="vox-card p-6 md:p-8">
            {FAQS.map((f) => (
              <details key={f.q} className="group border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <summary className="flex items-center justify-between cursor-pointer py-5 font-semibold text-[0.9375rem] list-none [&::-webkit-details-marker]:hidden" style={{ color: 'var(--text-primary)' }}>
                  {f.q}
                  <span className="ml-4 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }}>⌄</span>
                </summary>
                <p className="pb-5 text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
          }),
        }}
      />
    </div>
  )
}
