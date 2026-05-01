import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

export const metadata = {
  title: 'Privacy Policy | Voxility',
  description: 'How Voxility collects, uses, stores, and protects your data, including data obtained through connected platforms like Facebook, Instagram, and your CRM.',
}

const LAST_UPDATED = '1 May 2026'

export default function PrivacyPage() {
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
            Privacy <span className="text-gradient">Policy</span>
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Last updated: {LAST_UPDATED}</p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto space-y-8 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>

          <Block title="Who we are">
            Voxility is operated by Kroc Fitness &amp; Lifestyle Pty Ltd (&ldquo;Voxility&rdquo;,
            &ldquo;we&rdquo;, &ldquo;us&rdquo;). We provide an AI conversational agent platform that
            connects to your CRM and messaging channels (including Facebook Pages, Instagram,
            SMS, and voice) to handle customer conversations on your behalf.
          </Block>

          <Block title="What we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Account data.</strong> Email, name, workspace name, and authentication tokens.</li>
              <li><strong>Connected-platform data.</strong> Access tokens and metadata for the platforms you connect &mdash; e.g. Facebook Page IDs, Instagram Business accounts, CRM contact lists, calendars.</li>
              <li><strong>Conversation data.</strong> Messages exchanged between your agents and end users on connected channels, including timestamps and channel identifiers.</li>
              <li><strong>Usage data.</strong> Logs of how you use the product (page views, feature usage, error reports) to operate and improve the service.</li>
            </ul>
          </Block>

          <Block title="How we use it">
            <ul className="list-disc pl-5 space-y-2">
              <li>To run your AI agents &mdash; receive incoming messages, generate replies, send them back through the original channel.</li>
              <li>To sync contacts, appointments, and pipeline updates with your connected CRM.</li>
              <li>To provide product analytics and account support.</li>
              <li>To detect abuse, debug errors, and meet legal obligations.</li>
            </ul>
            <p className="mt-3">
              We do not sell your data, and we do not use end-user message content to train
              foundation AI models.
            </p>
          </Block>

          <Block title="Data from Facebook and Instagram">
            When you connect a Facebook Page or Instagram Business account through Meta&rsquo;s
            Login for Business flow, we receive a Page access token (or System User token) and
            metadata for the assets you select during consent. We use this exclusively to send
            and receive messages through Messenger and Instagram Direct on your behalf.
            <p className="mt-3">
              We retain these tokens for as long as the connection is active. If you remove
              Voxility from <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener noreferrer" className="underline">Facebook Settings &rarr; Business Integrations</a>,
              Meta sends a deauthorization webhook and we automatically purge the token and
              cached Page metadata.
            </p>
          </Block>

          <Block title="Sharing">
            We share data only with subprocessors required to run the service: cloud hosting
            (Vercel), database (Supabase), AI inference providers (OpenAI, Anthropic), and
            telephony (Twilio, Vonage). Each subprocessor is contractually bound to confidentiality
            and security obligations. We don&rsquo;t share your data with advertisers or data brokers.
          </Block>

          <Block title="Retention">
            Account, workspace, and conversation data is retained for as long as your account
            is active. Connected-platform tokens are deleted when you disconnect that platform.
            Backups are retained for 30 days. After account deletion, all personal data is
            removed within 30 days, except where we&rsquo;re required by law to retain billing or
            audit records.
          </Block>

          <Block title="Your rights">
            You can access, correct, or delete your data at any time. To request deletion, see
            our <Link href="/data-deletion" className="underline">Data Deletion page</Link> or
            email us at <a href="mailto:support@voxility.io" className="underline">support@voxility.io</a>.
            If you&rsquo;re in the EU, UK, or California, you have additional rights under GDPR,
            UK GDPR, or CCPA respectively &mdash; including the right to object to processing
            and the right to data portability. We&rsquo;ll respond to verified requests within 30 days.
          </Block>

          <Block title="Security">
            We encrypt data in transit (TLS 1.2+) and at rest (AES-256). Access tokens are
            encrypted with a key separate from the application database. Production access is
            limited to authorized engineering staff and audited.
          </Block>

          <Block title="Children">
            Voxility is not intended for use by anyone under 16. We do not knowingly collect
            personal information from children. If you believe a child has provided us with
            personal information, contact us and we&rsquo;ll delete it.
          </Block>

          <Block title="Changes">
            We may update this policy from time to time. Material changes will be communicated
            by email or in-app notice at least 14 days before they take effect.
          </Block>

          <Block title="Contact">
            Questions or requests:{' '}
            <a href="mailto:support@voxility.io" className="underline">support@voxility.io</a>.
          </Block>

        </div>
      </section>

      <footer className="border-t py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <VoxilityLogo height={16} />
          <div className="flex items-center gap-6">
            <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
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
