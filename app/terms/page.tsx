import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

export const metadata = {
  title: 'Terms of Service | Voxility',
  description: 'Terms governing your use of the Voxility AI conversational agent platform.',
}

const LAST_UPDATED = '1 May 2026'

export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}>
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

      <section className="relative py-20 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(250,77,46,0.08), transparent 50%)' }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <span className="section-label inline-block mb-4">Legal</span>
          <h1 className="font-bold tracking-tight mb-4" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)' }}>
            Terms of <span className="text-gradient">Service</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto space-y-8 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>

          <Block title="Agreement">
            By creating a Voxility account or using the service, you agree to these Terms. The
            service is operated by Kroc Fitness &amp; Lifestyle Pty Ltd (&ldquo;Voxility&rdquo;,
            &ldquo;we&rdquo;). If you&rsquo;re using Voxility on behalf of a company, you confirm you
            have authority to bind that company to these Terms.
          </Block>

          <Block title="The service">
            Voxility provides an AI conversational agent platform that connects to your CRM
            and messaging channels &mdash; including Facebook Pages, Instagram, SMS, and voice
            &mdash; to handle customer conversations. Features may be added, changed, or removed
            during the beta period.
          </Block>

          <Block title="Your account">
            You&rsquo;re responsible for keeping your login credentials secure and for everything
            that happens under your account. Notify us promptly of any suspected unauthorized
            access. One person or entity per account.
          </Block>

          <Block title="Acceptable use">
            You agree not to:
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li>Use Voxility to send spam, deceptive, harassing, or unlawful messages.</li>
              <li>Impersonate any person or misrepresent your affiliation with one.</li>
              <li>Violate the platform policies of any connected channel (e.g.{' '}
                <a href="https://developers.facebook.com/terms/" target="_blank" rel="noopener noreferrer" className="underline">Meta Platform Terms</a>,{' '}
                <a href="https://www.twilio.com/legal/aup" target="_blank" rel="noopener noreferrer" className="underline">Twilio AUP</a>,
                or your CRM&rsquo;s terms).</li>
              <li>Attempt to reverse-engineer, probe, or interfere with the service.</li>
              <li>Resell or sublicense the service without our written agreement.</li>
            </ul>
            <p className="mt-3">
              We may suspend or terminate accounts that violate these rules, without notice
              where required to protect the platform or other users.
            </p>
          </Block>

          <Block title="Your content and data">
            You retain ownership of conversation data, contacts, and other content you bring
            into Voxility. You grant us a limited license to process this content solely to
            provide the service to you. See our{' '}
            <Link href="/privacy" className="underline">Privacy Policy</Link> for details.
          </Block>

          <Block title="AI-generated output">
            Voxility uses third-party AI models (e.g. OpenAI, Anthropic) to generate replies
            in conversations. AI output may be inaccurate or unsuitable for sensitive
            decisions; you&rsquo;re responsible for reviewing and approving the agent
            configuration that drives those replies. Don&rsquo;t use Voxility for medical, legal,
            or financial advice without appropriate human oversight.
          </Block>

          <Block title="Connected platforms">
            When you connect Facebook, Instagram, your CRM, or any other third-party service,
            your use of those platforms is governed by their own terms. Voxility is not
            responsible for outages, policy changes, or token revocations on those platforms.
          </Block>

          <Block title="Beta service">
            Voxility is currently in beta. The service is provided &ldquo;as is&rdquo; and
            &ldquo;as available&rdquo;, without warranties of any kind. We don&rsquo;t guarantee
            uninterrupted or error-free operation. Beta users may receive features that change
            or are removed before general release.
          </Block>

          <Block title="Fees">
            During beta, the service is free. When paid plans launch, we&rsquo;ll give you at
            least 30 days&rsquo; notice before any account is converted to a paid plan.
          </Block>

          <Block title="Limitation of liability">
            To the maximum extent permitted by law, Voxility&rsquo;s total liability for any
            claim arising from these Terms or the service is limited to the fees you paid us
            in the 12 months before the claim (or AUD $100 if no fees were paid). We are not
            liable for indirect, incidental, consequential, or punitive damages.
          </Block>

          <Block title="Termination">
            You can close your account at any time from workspace settings or by emailing us.
            We can suspend or terminate your account if you breach these Terms or use the
            service in a way that risks harm to us, other users, or third parties. On
            termination, your data is handled per our{' '}
            <Link href="/data-deletion" className="underline">Data Deletion policy</Link>.
          </Block>

          <Block title="Changes">
            We may update these Terms. Material changes will be communicated by email or
            in-app notice at least 14 days before they take effect. Continued use of the
            service after the effective date constitutes acceptance.
          </Block>

          <Block title="Governing law">
            These Terms are governed by the laws of New South Wales, Australia. Disputes will
            be resolved in the courts of New South Wales unless local consumer law requires
            otherwise.
          </Block>

          <Block title="Contact">
            <a href="mailto:support@voxility.io" className="underline">support@voxility.io</a>
          </Block>

        </div>
      </section>

      <footer className="border-t py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <VoxilityLogo height={16} />
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
            <Link href="/data-deletion" className="hover:text-white transition-colors">Data Deletion</Link>
            <Link href="/support" className="hover:text-white transition-colors">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="vox-card p-6 rounded-xl">
      <h2 className="font-semibold text-base mb-3" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
