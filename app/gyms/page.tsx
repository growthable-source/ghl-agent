import type { Metadata } from 'next'
import Link from 'next/link'
import Script from 'next/script'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import EmailCaptureForm from '@/components/landing/EmailCaptureForm'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

export const metadata: Metadata = {
  title: 'AI for Gyms & Fitness Studios — Never Miss a Lead | Voxility',
  description:
    'Voxility helps gyms and fitness studios across the US & Canada win more members: instant speed-to-lead, ad automation that turns clicks into booked tours, and a voice AI agent that answers every call 24/7. Book more tours, lose fewer leads.',
  alternates: { canonical: `${SITE_URL}/gyms` },
  openGraph: {
    title: 'AI for Gyms & Fitness Studios — Never Miss a Lead',
    description:
      'Instant speed-to-lead, ad automation, and a 24/7 voice AI receptionist — built for gyms and fitness studios in the US & Canada.',
    url: `${SITE_URL}/gyms`,
    type: 'website',
  },
}

const PIXEL_ID = '1285462570417058'

// Three pillars, gym-framed. Each maps to a real Voxility capability.
const PILLARS: { eyebrow: string; title: string; body: string; icon: React.ReactNode }[] = [
  {
    eyebrow: 'Speed to lead',
    title: 'Reply in seconds, not hours',
    body: 'The instant someone fills out a form, DMs your page, or calls and you miss it, Voxility texts and calls back automatically — qualifies them and books a tour while they’re still interested. Leads contacted within five minutes convert dramatically more than ones you get to tomorrow.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    eyebrow: 'Ad automation',
    title: 'Turn ad spend into booked tours',
    body: 'Connect your Meta and Google ads and every click that becomes a lead is instantly engaged, qualified, and booked — with the outcome written back to your CRM. See real cost-per-tour and cost-per-member, not just cost-per-click.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
      </svg>
    ),
  },
  {
    eyebrow: 'Voice AI agents',
    title: 'An AI receptionist that never misses a call',
    body: 'A natural, human-sounding voice answers every call 24/7 — handles “how much is membership?”, books trials and tours straight onto your calendar, and routes real issues to your team. Even at 11pm on a Sunday, no call goes to voicemail.',
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
  { n: '3', title: 'Tours & trials get booked', body: 'The agent qualifies, answers questions, and books straight onto your calendar — then logs it in your CRM.' },
  { n: '4', title: 'You see members, not clicks', body: 'Every interaction is tracked end-to-end, so you know exactly which ads and channels fill your floor.' },
]

const FAQS: { q: string; a: string }[] = [
  { q: 'Does it work with my gym software / CRM?', a: 'Yes. Voxility installs from the GoHighLevel Marketplace and connects to HubSpot, and the agent reads and writes your CRM natively — leads, tours, and members all stay in sync.' },
  { q: 'What does it actually say to leads?', a: 'You set the script and guardrails. It answers questions about memberships, hours, and classes from your own info, qualifies the lead, and books a tour or free trial — it never invents pricing or promises you didn’t set.' },
  { q: 'Can it book tours and trials on my calendar?', a: 'Yes — it checks real-time availability and books during the conversation, with automatic confirmations and reminders to cut no-shows.' },
  { q: 'Does the voice sound like a robot?', a: 'No. It uses natural, human-sounding voices — most callers don’t realize they’re talking to an AI until you tell them.' },
  { q: 'Is this available in the US and Canada?', a: 'Yes — Voxility is built for gyms and fitness studios across both the US and Canada, with local phone numbers in both countries.' },
]

export default function GymsLandingPage() {
  return (
    <div data-theme="soft-light" className="min-h-screen overflow-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {/* ── Meta Pixel (scoped to this page) ── */}
      <Script id="meta-pixel-gyms" strategy="afterInteractive">
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
          <div className="section-label mb-3">For gyms &amp; fitness studios · US &amp; Canada</div>
          <h1 className="text-4xl md:text-[3.25rem] font-extrabold tracking-tight leading-[1.06] mb-5" style={{ color: 'var(--text-primary)' }}>
            Turn every lead into a <span className="text-gradient">booked tour</span> — automatically.
          </h1>
          <p className="text-lg leading-[1.6] max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Voxility answers every call, text, and ad inquiry in seconds, 24/7 — qualifies the lead, books the tour, and follows up — so your front desk never loses a member to a faster gym down the road.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <EmailCaptureForm source="gyms" cta="Get a demo" />
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Built for gyms across the US &amp; Canada. Free while in beta — no card required.
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
              Three ways gyms grow with Voxility
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
            <p className="mt-2 text-[0.9375rem]" style={{ color: 'var(--text-secondary)' }}>No new software for your team to learn — it works the leads you already get.</p>
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
            Stop losing members to slow follow-up
          </h2>
          <p className="mb-7 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            See exactly how Voxility would work for your gym — book a quick demo and we&apos;ll show you it answering a lead live.
          </p>
          <div className="flex flex-col items-center gap-3">
            <EmailCaptureForm source="gyms_cta" cta="Get a demo" />
            <Link href="/login?mode=signup" className="text-sm underline" style={{ color: 'var(--accent-primary)' }}>
              or start building free →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[760px] mx-auto">
          <h2 className="text-2xl font-bold tracking-tight mb-6 text-center" style={{ color: 'var(--text-primary)' }}>Gym owner questions</h2>
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
