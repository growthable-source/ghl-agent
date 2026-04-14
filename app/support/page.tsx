import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

export const metadata = {
  title: 'Support | Voxility',
  description: 'Get help with Voxility. Browse our documentation, submit feedback, or reach out to our team.',
}

function CardLink({ href, title, description, external, icon }: { href: string; title: string; description: string; external?: boolean; icon: React.ReactNode }) {
  const Tag = external ? 'a' : Link
  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  return (
    <Tag
      href={href}
      className="vox-card p-6 rounded-xl flex gap-5 items-start hover:border-zinc-600 transition-colors"
      {...externalProps}
    >
      <div className="icon-box shrink-0">{icon}</div>
      <div>
        <h3 className="font-semibold text-sm mb-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          {title}
          {external && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>&#8599;</span>}
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{description}</p>
      </div>
    </Tag>
  )
}

export default function SupportPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}>
      {/* ═══ Nav ═══ */}
      <header className="sticky top-0 z-50 border-b backdrop-blur-xl" style={{ borderColor: 'var(--border)', background: 'rgba(5,8,15,0.85)' }}>
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <VoxilityLogo variant="mark" height={26} />
            <span className="font-bold text-sm">Voxility</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/docs" className="hover:text-white transition-colors" style={{ color: 'var(--text-secondary)' }}>Docs</Link>
            <Link href="/login" className="btn-primary text-sm py-2 px-5">Log in</Link>
          </div>
        </div>
      </header>

      {/* ═══ Hero ═══ */}
      <section className="relative py-20 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(250,77,46,0.08), transparent 50%)' }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <span className="section-label inline-block mb-4">Support</span>
          <h1 className="font-bold tracking-tight mb-4" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)' }}>
            How can we <span className="text-gradient">help?</span>
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Find answers in our docs, submit feature requests, or get in touch with our team.
          </p>
        </div>
      </section>

      {/* ═══ Support Options ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto space-y-4">
          <CardLink
            href="/docs"
            title="Documentation"
            description="Step-by-step setup guides, feature documentation, CRM integration instructions, and FAQs."
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            }
          />

          <CardLink
            href="https://voxility.canny.io"
            title="Feature requests and bug reports"
            description="Submit ideas, vote on upcoming features, and report bugs through our public feedback board."
            external
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
            }
          />

          <CardLink
            href="mailto:support@voxility.io"
            title="Email support"
            description="Reach our team directly at support@voxility.io. We typically respond within a few hours on business days."
            external
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            }
          />
        </div>
      </section>

      <div className="orange-rule max-w-2xl mx-auto" />

      {/* ═══ Common Questions ═══ */}
      <section className="px-6 py-20">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold mb-8">Common questions</h2>
          <div className="space-y-3">
            <FaqItem
              q="I connected my CRM but don't see any contacts"
              a="After connecting, allow a few minutes for the initial sync. If contacts still don't appear, check that the OAuth scopes were approved during connection. You can reconnect from Integrations to re-authorize."
            />
            <FaqItem
              q="My agent isn't responding on SMS/WhatsApp"
              a="Make sure the channel is enabled in the agent's Deploy tab and that the phone number is assigned. For WhatsApp, the number must be approved through your provider (Twilio or Vonage)."
            />
            <FaqItem
              q="How do I transfer calls to a human?"
              a="Add a rule or stop condition in your agent's configuration that triggers a transfer. You can specify a phone number or use your CRM's round-robin assignment to route to available team members."
            />
            <FaqItem
              q="Can I use Voxility without a CRM?"
              a="Yes. While CRM integration unlocks the full feature set (contact sync, appointment booking, pipeline updates), you can use Voxility standalone for voice and messaging automation."
            />
            <FaqItem
              q="How do I cancel or change my plan?"
              a="During beta, everything is free. When paid plans launch, you'll be able to manage your subscription from the workspace Settings page."
            />
            <FaqItem
              q="I found a bug — where do I report it?"
              a="Head to our feedback board at voxility.canny.io and submit a bug report. Include screenshots or steps to reproduce if possible — it helps us fix things faster."
            />
          </div>
        </div>
      </section>

      {/* ═══ Still Need Help ═══ */}
      <section className="relative py-24 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 40%, rgba(250,77,46,0.08), transparent 50%)' }} />
        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Still need help?</h2>
          <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>
            Our team is here for you. Drop us a line and we&apos;ll get back to you as soon as possible.
          </p>
          <a href="mailto:support@voxility.io" className="btn-primary text-base py-3 px-8">
            Contact support
          </a>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <VoxilityLogo height={16} />
          <div className="flex items-center gap-6">
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
            <Link href="/login" className="hover:text-white transition-colors">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group vox-card rounded-xl">
      <summary className="flex items-center justify-between p-5 cursor-pointer text-sm font-medium list-none">
        {q}
        <svg className="w-4 h-4 shrink-0 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className="px-5 pb-5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {a}
      </div>
    </details>
  )
}
