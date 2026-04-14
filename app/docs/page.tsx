import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

export const metadata = {
  title: 'Documentation | Voxility',
  description: 'Learn how to set up and use Voxility AI agents for your business.',
}

function StepNumber({ n }: { n: number }) {
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
      style={{ background: 'linear-gradient(135deg, #fa4d2e, #fb8e6a)', color: '#fff' }}
    >
      {n}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="vox-card p-6 rounded-xl">
      <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </div>
    </div>
  )
}

export default function DocsPage() {
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
            <Link href="/support" className="hover:text-white transition-colors" style={{ color: 'var(--text-secondary)' }}>Support</Link>
            <Link href="/login" className="btn-primary text-sm py-2 px-5">Log in</Link>
          </div>
        </div>
      </header>

      {/* ═══ Hero ═══ */}
      <section className="relative py-20 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(250,77,46,0.08), transparent 50%)' }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <span className="section-label inline-block mb-4">Documentation</span>
          <h1 className="font-bold tracking-tight mb-4" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)' }}>
            Get started with <span className="text-gradient">Voxility</span>
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Everything you need to connect your CRM, build AI agents, and start automating conversations.
          </p>
        </div>
      </section>

      {/* ═══ Quick Start ═══ */}
      <section className="px-6 pb-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold mb-8">Quick start</h2>

          <div className="space-y-6">
            {/* Step 1 */}
            <div className="flex gap-5">
              <StepNumber n={1} />
              <div className="flex-1 pt-1.5">
                <h3 className="font-semibold mb-2">Create your workspace</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Sign up with Google or email. Voxility will create a workspace for you automatically. If you use a company email, your workspace is named after your domain. You can customize the name and icon at any time.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-5">
              <StepNumber n={2} />
              <div className="flex-1 pt-1.5">
                <h3 className="font-semibold mb-2">Connect your CRM</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Head to <strong>Integrations</strong> in the sidebar and connect GoHighLevel or HubSpot. This lets Voxility read your contacts, book appointments, and sync conversation history back to your CRM.
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-5">
              <StepNumber n={3} />
              <div className="flex-1 pt-1.5">
                <h3 className="font-semibold mb-2">Build your first agent</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Click <strong>Overview &rarr; New Agent</strong>. Give it a name, choose a persona (friendly, professional, etc.), and configure what it should do: qualify leads, book appointments, answer FAQs, or all of the above.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-5">
              <StepNumber n={4} />
              <div className="flex-1 pt-1.5">
                <h3 className="font-semibold mb-2">Test in the Playground</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Use the built-in <strong>Playground</strong> to have a live conversation with your agent before deploying it. Tweak the persona, rules, and knowledge base until it behaves exactly how you want.
                </p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="flex gap-5">
              <StepNumber n={5} />
              <div className="flex-1 pt-1.5">
                <h3 className="font-semibold mb-2">Deploy and go live</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Open <strong>Deploy</strong> to assign a phone number for voice calls, connect SMS/WhatsApp channels, or embed the chat widget on your website. Your agent starts handling conversations immediately.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="orange-rule max-w-3xl mx-auto" />

      {/* ═══ Feature Guides ═══ */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold mb-8">Feature guides</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <SectionCard title="Voice AI">
              <p>Assign a phone number to your agent and it can make and receive calls with natural-sounding voice AI. Configure the voice, language, and speaking style from the Voice tab.</p>
              <p>Supports call transfer to a human, voicemail detection, and automatic call summaries synced to your CRM.</p>
            </SectionCard>

            <SectionCard title="Multi-channel messaging">
              <p>Deploy your agent across SMS, WhatsApp, Facebook Messenger, Instagram DM, Google Business Messages, live chat, and email — all from a single configuration.</p>
              <p>Conversations are unified in the Conversations view so you never lose context across channels.</p>
            </SectionCard>

            <SectionCard title="Knowledge base">
              <p>Upload documents, paste text, or crawl your website to give your agent domain-specific knowledge. It uses retrieval-augmented generation to answer questions accurately.</p>
              <p>Supported formats: PDF, DOCX, TXT, CSV, and web URLs.</p>
            </SectionCard>

            <SectionCard title="Lead qualification">
              <p>Add qualifying questions in the Goals tab. Your agent will naturally weave these into conversation to score and categorize leads before handing off or booking.</p>
              <p>Qualification data syncs to custom fields in your CRM automatically.</p>
            </SectionCard>

            <SectionCard title="Appointment booking">
              <p>Connect your calendar and let the agent check availability, suggest times, and confirm bookings — all within the conversation flow.</p>
              <p>Supports Google Calendar and CRM-native calendars in GoHighLevel.</p>
            </SectionCard>

            <SectionCard title="Rules and stop conditions">
              <p>Define rules your agent must follow (e.g. &ldquo;never discuss pricing&rdquo;) and stop conditions that end the conversation or transfer to a human.</p>
              <p>Rules are enforced at every turn, so the agent stays on-brand and compliant.</p>
            </SectionCard>

            <SectionCard title="Follow-up sequences">
              <p>Create multi-step follow-up sequences that trigger after a conversation ends. Set timing, conditions, and message templates for automated nurturing.</p>
              <p>Sequences pause automatically if the contact replies, so conversations feel natural.</p>
            </SectionCard>

            <SectionCard title="Team workspaces">
              <p>Invite team members to your workspace. Same-domain colleagues are free; cross-domain collaborators will be available on paid plans.</p>
              <p>Roles include Owner, Admin, and Member with different permission levels.</p>
            </SectionCard>
          </div>
        </div>
      </section>

      <div className="orange-rule max-w-3xl mx-auto" />

      {/* ═══ CRM Integration ═══ */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold mb-8">CRM integration</h2>
          <div className="space-y-4">
            <SectionCard title="GoHighLevel">
              <p>Voxility is a GoHighLevel Marketplace app. Install it from the GHL Marketplace or connect from <strong>Integrations &rarr; Connect GoHighLevel</strong> in your dashboard.</p>
              <p>Once connected, Voxility can access contacts, conversations, calendars, pipelines, and custom fields. All agent interactions are logged as CRM activities.</p>
              <p>OAuth scopes requested: contacts, conversations, calendars, locations, and opportunities.</p>
            </SectionCard>

            <SectionCard title="HubSpot">
              <p>Connect HubSpot from <strong>Integrations &rarr; Connect HubSpot</strong>. Voxility syncs contacts, deals, and meeting links to power your AI agents.</p>
              <p>Conversation transcripts and lead qualification data are pushed back to HubSpot as timeline events and contact properties.</p>
            </SectionCard>
          </div>
        </div>
      </section>

      <div className="orange-rule max-w-3xl mx-auto" />

      {/* ═══ FAQ ═══ */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-xl font-semibold mb-8">Frequently asked questions</h2>
          <div className="space-y-3">
            <FaqItem q="Is Voxility free?" a="Yes, Voxility is free during the beta period. We'll introduce pricing with plans designed for agencies and SMBs as we exit beta." />
            <FaqItem q="What CRMs do you support?" a="GoHighLevel and HubSpot are supported today. We're actively working on Salesforce and other integrations." />
            <FaqItem q="Can I use my own phone number?" a="Yes. You can port an existing number or purchase a new one directly through the platform. Twilio and Vonage numbers are supported." />
            <FaqItem q="How does the AI handle things it doesn't know?" a="You configure fallback behavior — it can transfer to a human, take a message, or offer to call back. You set the rules, and the agent follows them." />
            <FaqItem q="Is my data secure?" a="All data is encrypted in transit and at rest. We do not use your conversations to train AI models. Your CRM credentials are stored encrypted and never shared." />
            <FaqItem q="Can multiple team members use the same workspace?" a="Yes. Invite colleagues to your workspace from the onboarding flow or settings. Same-domain users are free; cross-domain invites will be available on paid plans." />
          </div>
        </div>
      </section>

      {/* ═══ CTA ═══ */}
      <section className="relative py-24 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 40%, rgba(250,77,46,0.08), transparent 50%)' }} />
        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to get started?</h2>
          <p className="mb-8" style={{ color: 'var(--text-secondary)' }}>Build your first AI agent in under 5 minutes. Free while in beta.</p>
          <Link href="/login?mode=signup" className="btn-primary text-base py-3 px-8">
            Create your account
          </Link>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <footer className="border-t py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <VoxilityLogo height={16} />
          <div className="flex items-center gap-6">
            <Link href="/support" className="hover:text-white transition-colors">Support</Link>
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
