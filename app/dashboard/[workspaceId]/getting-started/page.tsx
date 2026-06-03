/**
 * Getting Started — landing page for any newly-installed workspace.
 *
 * Server component. Pulls the workspaceId + installSource off the
 * Workspace row so the headline and the "Connect your CRM" step can
 * be tailored — marketplace installs already have LeadConnector wired
 * up, direct signups still need to do that.
 *
 * Everything else is static, brand-on copy. CRM references are always
 * "LeadConnector" — never "GoHighLevel" / "HighLevel" / "GHL".
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string }> }

export default async function GettingStartedPage({ params }: Params) {
  const { workspaceId } = await params

  // The layout already gates auth + workspace membership; this fetch is
  // just for the personalised greeting + install-source branching.
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true, installSource: true },
  }).catch(() => null)

  if (!workspace) return notFound()

  const fromMarketplace = workspace.installSource === 'ghl_marketplace'

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-4xl mx-auto px-6 py-10 lg:px-10 lg:py-14">

        {/* ─── Hero ──────────────────────────────────────────────────── */}
        <section
          className="relative rounded-2xl overflow-hidden mb-10"
          style={{
            background: 'linear-gradient(135deg, #fa4d2e 0%, #fb8951 50%, #fb8e6a 100%)',
            boxShadow: '0 10px 40px -10px rgba(250, 77, 46, 0.25)',
          }}
        >
          {/* Soft texture for the hero. Pure CSS so we avoid hosting an
              image asset and the gradient stays the visual focus. */}
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background:
                'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.18) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.10) 0%, transparent 40%)',
            }}
          />
          <div className="relative px-7 py-10 lg:px-12 lg:py-14 text-white">
            <p className="text-xs font-semibold tracking-wider uppercase opacity-80 mb-3">
              Welcome to Voxility
            </p>
            <h1 className="text-3xl lg:text-4xl font-bold leading-tight tracking-tight">
              Let&apos;s get {workspace.name} live.
            </h1>
            <p className="mt-4 max-w-xl text-base lg:text-lg leading-relaxed opacity-90">
              Voxility runs AI agents that talk to your contacts on every channel —
              SMS, WhatsApp, Email, Live Chat, Voice — and use your CRM as the
              source of truth. You&apos;ll have your first agent live in under
              ten minutes.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href={`/dashboard/${workspaceId}/agents/new`}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold bg-white text-[#1c1917] hover:bg-stone-100 transition-colors"
              >
                Build your first agent
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </Link>
              <Link
                href={`/dashboard/${workspaceId}/integrations`}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium border border-white/40 text-white hover:bg-white/10 transition-colors"
              >
                See integrations
              </Link>
            </div>
          </div>
        </section>

        {/* ─── 4-step quickstart ──────────────────────────────────────── */}
        <section className="mb-14">
          <header className="mb-6">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Your first agent in four steps
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Each step takes a couple of minutes. You can come back and tune
              anything later.
            </p>
          </header>

          <ol className="space-y-3">
            <StepCard
              n={1}
              title={fromMarketplace ? 'Your CRM is already connected' : 'Connect your CRM'}
              done={fromMarketplace}
              body={
                fromMarketplace
                  ? 'You installed via the LeadConnector marketplace, so your sub-account is already wired up — contacts, conversations, calendars, pipelines, and tags are ready to use. Skip ahead.'
                  : 'Voxility uses your CRM as the source of truth for contacts, conversations, pipelines, and calendars. Connect LeadConnector to give your agents access to everything they need to respond intelligently.'
              }
              cta={fromMarketplace ? null : {
                label: 'Connect LeadConnector',
                href: `/dashboard/${workspaceId}/integrations`,
              }}
            />

            <StepCard
              n={2}
              title="Build your first agent"
              body="Pick a starting template — Inbound Sales, Inbound Support, Outbound Follow-up, or Live Chat — and the wizard pre-fills the personality, prompts, and recommended tools. You can edit any of it before deploying."
              cta={{
                label: 'Open the agent wizard',
                href: `/dashboard/${workspaceId}/agents/new`,
              }}
            />

            <StepCard
              n={3}
              title="Pick the channels your agent listens on"
              body="SMS and WhatsApp are the most common starting point. You can add Email, Facebook, Instagram, Google Business Profile, and Live Chat as you go — the agent picks up each new channel without re-training."
              channelChips
            />

            <StepCard
              n={4}
              title="Deploy and watch it work"
              body="Hit Deploy on your agent. From that moment, every inbound on the channels you picked routes through your routing rules to the matching agent, runs the agent, and replies in your voice. Every conversation lands in your unified inbox so you can spot-check, correct, or take over at any time."
              cta={{
                label: 'Open the inbox',
                href: `/dashboard/${workspaceId}/inbox`,
              }}
            />
          </ol>
        </section>

        {/* ─── Core concepts ─────────────────────────────────────────── */}
        <section className="mb-14">
          <header className="mb-6">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              The five things that make Voxility work
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
              You don&apos;t need to read these before building. They&apos;re
              here so the terms in the dashboard click.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ConceptCard
              icon={<IconSpark />}
              title="Agents"
              body="An agent is one personality with one job — Inbound Sales, Booking, Post-purchase Support. You can run as many as your plan allows and switch between them per channel or per tag."
            />
            <ConceptCard
              icon={<IconChannels />}
              title="Channels"
              body="Where the agent listens and speaks. Same agent can run across SMS, WhatsApp, Email, Live Chat, FB, IG, GMB, and Voice — each one gets its own deployment toggle."
            />
            <ConceptCard
              icon={<IconRules />}
              title="Routing rules"
              body="The decision layer between an inbound message and the agent. Match by tag, keyword, regex, or the channel itself. First match wins. Without a rule, an agent never fires — by design."
            />
            <ConceptCard
              icon={<IconKnowledge />}
              title="Knowledge"
              body="Collections of source material your agent can reference at conversation time — your website, help articles, pricing PDFs, FAQs. Add a URL or upload a file, Voxility chunks and indexes it."
            />
            <ConceptCard
              icon={<IconApprovals />}
              title="Approvals"
              body="Optional human-in-the-loop. When an approval rule fires, the agent drafts but doesn&apos;t send — a teammate reviews and clicks Approve. Useful for refunds, pricing changes, anything sensitive."
            />
            <ConceptCard
              icon={<IconTools />}
              title="Tools"
              body="The actions an agent can take — book an appointment, add a tag, move an opportunity, send an SMS, look up an order. Pick which tools each agent is allowed; the runtime hides everything else."
            />
          </div>
        </section>

        {/* ─── Example setups ────────────────────────────────────────── */}
        <section className="mb-14">
          <header className="mb-6">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Common setups to copy
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Each of these is a starting template in the agent wizard. Pick the
              closest fit and tailor from there.
            </p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <UseCaseCard
              tone="emerald"
              tag="Inbound Sales"
              title="Reply, qualify, book"
              body="Picks up new SMS / WhatsApp leads, qualifies in conversation, books on your calendar. Hand-off to a human when the lead asks for one or hits a custom approval rule."
            />
            <UseCaseCard
              tone="violet"
              tag="Support"
              title="Answer, route, escalate"
              body="Answers from your help center and product docs. Escalates anything outside its knowledge to a teammate with the conversation summary already drafted."
            />
            <UseCaseCard
              tone="amber"
              tag="Outbound Follow-up"
              title="Re-engage stale contacts"
              body="Runs a sequence on contacts that go quiet — reminds them about the appointment, the abandoned cart, or the open quote. Stops on reply and hands them to your inbound agent."
            />
          </div>
        </section>

        {/* ─── Where to next ─────────────────────────────────────────── */}
        <section className="mb-6">
          <header className="mb-6">
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              Need a hand?
            </h2>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <NextLink
              href={`/dashboard/${workspaceId}/help`}
              title="Help reference"
              body="Short guides for the dense parts — merge fields, custom fields, working hours."
            />
            <NextLink
              href={`/dashboard/${workspaceId}/integrations`}
              title="Integrations"
              body="Add channels, calendars, payment, ads, and analytics surfaces."
            />
            <NextLink
              href="mailto:support@voxility.ai"
              title="Talk to a human"
              body="Hit us up at support@voxility.ai — we read every message."
              external
            />
          </div>
        </section>

        {/* Brand footer */}
        <footer
          className="mt-12 pt-6 text-xs text-center"
          style={{
            color: 'var(--text-muted)',
            borderTop: '1px solid var(--border)',
          }}
        >
          Built with care by Voxility · You can re-open this guide any time from the sidebar.
        </footer>
      </div>
    </div>
  )
}

// ─── Building blocks ────────────────────────────────────────────────

function StepCard({
  n, title, body, cta, done, channelChips,
}: {
  n: number
  title: string
  body: string
  cta?: { label: string; href: string } | null
  done?: boolean
  channelChips?: boolean
}) {
  return (
    <li
      className="rounded-xl p-5 lg:p-6 flex gap-5"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold"
        style={
          done
            ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e' }
            : { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' }
        }
        aria-hidden
      >
        {done ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          n
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
          {title}
          {done && (
            <span
              className="ml-2 inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
            >
              Done
            </span>
          )}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {body}
        </p>
        {channelChips && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              ['SMS',       '#22d3ee', 'rgba(34,211,238,0.12)'],
              ['WhatsApp',  '#22c55e', 'rgba(34,197,94,0.12)'],
              ['Email',     '#a78bfa', 'rgba(167,139,250,0.12)'],
              ['Live Chat', '#fb923c', 'rgba(251,146,60,0.12)'],
              ['Facebook',  '#60a5fa', 'rgba(96,165,250,0.12)'],
              ['Instagram', '#f472b6', 'rgba(244,114,182,0.12)'],
              ['Google',    '#fbbf24', 'rgba(251,191,36,0.12)'],
              ['Voice',     '#a855f7', 'rgba(168,85,247,0.12)'],
            ].map(([label, color, bg]) => (
              <span
                key={label}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: bg, color }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
        {cta && (
          <Link
            href={cta.href}
            className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium hover:underline"
            style={{ color: '#fa4d2e' }}
          >
            {cta.label}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>
    </li>
  )
}

function ConceptCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div
      className="rounded-xl p-5"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{ background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' }}
        aria-hidden
      >
        {icon}
      </div>
      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{body}</p>
    </div>
  )
}

function UseCaseCard({
  tone, tag, title, body,
}: {
  tone: 'emerald' | 'violet' | 'amber'
  tag: string
  title: string
  body: string
}) {
  // Soft hue cards — each example gets its own accent so the page has a
  // clear visual rhythm without us inventing a sixth brand colour.
  const tones: Record<typeof tone, { fg: string; bg: string }> = {
    emerald: { fg: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    violet:  { fg: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
    amber:   { fg: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  }
  const t = tones[tone]

  return (
    <div
      className="rounded-xl p-5 flex flex-col"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <span
        className="self-start text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
        style={{ background: t.bg, color: t.fg }}
      >
        {tag}
      </span>
      <h3 className="font-semibold text-base mt-3" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{body}</p>
    </div>
  )
}

function NextLink({
  href, title, body, external,
}: {
  href: string
  title: string
  body: string
  external?: boolean
}) {
  const A: any = external ? 'a' : Link
  const extra = external ? { target: '_blank', rel: 'noreferrer' } : {}
  return (
    <A
      href={href}
      {...extra}
      className="block rounded-xl p-5 transition-colors hover:border-[var(--border-secondary)]"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      <h3 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{body}</p>
    </A>
  )
}

// ─── Inline icons (no Lucide dep) ───────────────────────────────────

function IconSpark() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
    </svg>
  )
}

function IconChannels() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}

function IconRules() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h12M3 12h9m-9 5h6M19 5l2 2-2 2M19 11l2 2-2 2M19 17l2 2-2 2" />
    </svg>
  )
}

function IconKnowledge() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}

function IconApprovals() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function IconTools() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z" />
    </svg>
  )
}
