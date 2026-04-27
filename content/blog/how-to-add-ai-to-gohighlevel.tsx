import Link from 'next/link'
import type { BlogPostMeta } from '@/lib/blog-posts'
import { H2, H3, P, Lede, UL, OL, LI, Strong, A, Callout, Code } from '@/components/blog/Prose'

export const meta: BlogPostMeta = {
  slug: 'how-to-add-ai-to-gohighlevel',
  title: 'How to add AI to GoHighLevel (step-by-step)',
  description: 'A practical walkthrough — from marketplace install to first live agent. Everything a non-technical operator needs to get a real AI agent answering calls and texts inside GoHighLevel.',
  category: 'Guides',
  publishedAt: '2026-04-24',
  author: 'Voxility',
  readingTimeMinutes: 7,
  tags: ['GoHighLevel', 'how-to', 'AI agents', 'setup'],
}

export default function Post() {
  return (
    <>
      <Lede>
        Adding AI to GoHighLevel doesn&apos;t need a developer, doesn&apos;t need API keys, and shouldn&apos;t need an entire afternoon. Here&apos;s the five-step path, what each step does under the hood, and the common potholes to avoid.
      </Lede>

      <Callout title="Before you start">
        You need a GoHighLevel agency or sub-account with at least one active Location. If you&apos;re brand new to GHL, set up the CRM first and come back when you have a few contacts and a pipeline configured — the AI becomes useful only once it has data to act on.
      </Callout>

      <H2 id="step-1-pick-a-platform">Step 1: Pick an AI agent platform</H2>

      <P>
        You have three broad options:
      </P>

      <UL>
        <LI>
          <Strong>GoHighLevel&apos;s built-in Conversation AI</Strong> — free, included in most plans, good for auto-replying to text and chat. Limited on voice and on the things you can let the AI actually <em>do</em>.
        </LI>
        <LI>
          <Strong>A marketplace add-on</Strong> like <A href="/">Voxility</A> — installs directly from the GHL marketplace, runs inside your account, has native CRM tools. Free while in beta.
        </LI>
        <LI>
          <Strong>A voice-only developer platform</Strong> like Retell or Vapi wired up via webhook — powerful, requires engineering.
        </LI>
      </UL>

      <P>
        We&apos;re going to walk through the marketplace add-on path using Voxility because that&apos;s what we build, but the shape of the process is the same for most tools — pick up whichever steps apply.
      </P>

      <H2 id="step-2-install">Step 2: Install from the marketplace</H2>

      <OL>
        <LI>
          Open the GoHighLevel marketplace (left sidebar in your agency view, or <Code>/marketplace</Code> from the dashboard).
        </LI>
        <LI>
          Search <Strong>Voxility</Strong> and click <Strong>Install</Strong>. Approve the requested scopes when HighLevel&apos;s OAuth prompt appears — the agent needs permission to read contacts, update opportunities, send messages, and create calendar events to do its job.
        </LI>
        <LI>
          Pick the sub-accounts you want to enable. You can always add more later; there&apos;s no penalty for starting narrow.
        </LI>
      </OL>

      <P>
        Behind the scenes, the install exchanges OAuth tokens, syncs your existing contacts and pipelines, and stands up one Workspace per sub-account. The whole thing takes about 30 seconds.
      </P>

      <Callout title="White-label note" tone="info">
        If your agency white-labels HighLevel (you probably see &ldquo;LeadConnector&rdquo; or your own brand instead of &ldquo;HighLevel&rdquo; in the UI), the install is identical — the marketplace + OAuth live at the agency level regardless of what your sub-accounts see.
      </Callout>

      <H2 id="step-3-build">Step 3: Build your first agent</H2>

      <P>
        After install, you&apos;ll land in the Voxility dashboard. Click <Strong>New agent</Strong> and fill in four things:
      </P>

      <OL>
        <LI>
          <Strong>Name</Strong> &mdash; what you&apos;ll call the agent internally. &ldquo;Inbound Sales Agent&rdquo; is fine.
        </LI>
        <LI>
          <Strong>Persona</Strong> &mdash; tone, formality, response length, whether to use emojis. Pick what matches how your best human rep talks.
        </LI>
        <LI>
          <Strong>System prompt</Strong> &mdash; plain English instructions. &ldquo;You&apos;re the inbound sales assistant for Acme HVAC. Our service area is Denver metro. Book a call whenever a caller mentions a broken unit or an estimate. If they ask about pricing, give ranges, not quotes.&rdquo; A paragraph or two is usually enough.
        </LI>
        <LI>
          <Strong>Qualifying questions</Strong> &mdash; the 3–6 things you want every inbound to answer. Budget, timeline, decision-maker status, service area. These map to custom fields in GHL automatically.
        </LI>
      </OL>

      <P>
        If you want voice, pick a voice on the <Strong>Voice</Strong> tab — 100+ ElevenLabs options with tunable speed and style. You can test any of them in the browser before assigning.
      </P>

      <H2 id="step-4-test">Step 4: Test before going live</H2>

      <P>
        This is the step most people skip, and it&apos;s the one that separates agents that work from agents that embarrass you on a real customer call.
      </P>

      <P>
        Voxility has two test surfaces:
      </P>

      <UL>
        <LI>
          <Strong>Playground</Strong> &mdash; send messages to the agent from your browser. Every reply has a thumbs up/down; thumbs down + a one-line note improves the prompt before the next turn.
        </LI>
        <LI>
          <Strong>Simulation Swarm</Strong> &mdash; write one scenario, seven personas (friendly, aggressive, passive, skeptical, confused, ready-to-buy, price-shopper) run the same conversation in parallel. Each one finds different things that break. Findings apply to your prompt automatically.
        </LI>
      </UL>

      <P>
        Run a swarm against any plausible customer scenario. Watch what the agent gets wrong. Thumbs-down the bad replies. By the time the swarm finishes (~7 minutes), your agent has absorbed half a dozen concrete improvements that would have taken you an hour to catch manually.
      </P>

      <H2 id="step-5-go-live">Step 5: Assign a channel and go live</H2>

      <P>
        Agents are off by default — deliberately. To turn yours on:
      </P>

      <OL>
        <LI>
          <Strong>Pick the channels</Strong> the agent handles: SMS, email, WhatsApp, Facebook Messenger, Instagram DM, Google Business chat, Live Chat, or inbound phone. You can turn individual channels on and off per agent.
        </LI>
        <LI>
          <Strong>For voice</Strong>: assign a phone number. Either a Twilio number you already own or one purchased through GHL. Incoming calls to that number ring the agent.
        </LI>
        <LI>
          <Strong>For messaging</Strong>: the agent auto-replies to the inbox entries matching its channel filter. If you want it to handle only specific tags or pipelines, add routing rules.
        </LI>
        <LI>
          <Strong>Flip the agent to Active.</Strong> Next inbound on any enabled channel gets handled.
        </LI>
      </OL>

      <Callout title="Safety net">
        Every agent has a <Strong>human-approval queue</Strong> you can turn on for the first week. Every outbound reply sits in the queue for you to review and release before it goes to the customer. Once you&apos;ve seen a hundred go through cleanly, flip it off. Nothing builds trust like watching the agent actually work on your real conversations.
      </Callout>

      <H2 id="common-mistakes">Common mistakes, in the order people make them</H2>

      <OL>
        <LI>
          <Strong>Writing a 3-page system prompt.</Strong> Don&apos;t. One paragraph. Let the detection rules and qualifying questions handle the specifics; the system prompt is for <em>tone and scope</em>, not a behavioural spec.
        </LI>
        <LI>
          <Strong>Enabling every tool.</Strong> More tools = more choices for the agent to make = more ways to go wrong. Start with the 6–8 you actually need.
        </LI>
        <LI>
          <Strong>Skipping the swarm test.</Strong> Real customers are weirder than you remember. The 7 minutes you save skipping it will cost you 7 weeks of bad conversations.
        </LI>
        <LI>
          <Strong>Ignoring the feedback loop.</Strong> Every sim and every real conversation proposes improvements. If you never check the learnings queue, you&apos;re leaving the best feature on the platform on the table.
        </LI>
      </OL>

      <H2 id="whats-next">What&apos;s next</H2>

      <P>
        A live agent that improves itself is the starting point, not the finish line. Three things worth doing once you&apos;re up:
      </P>

      <UL>
        <LI><Strong>Build a second agent</Strong> with a different persona for a different pipeline. Sub-accounts can have as many as their plan allows.</LI>
        <LI><Strong>Add a knowledge base</Strong> — upload pricing docs, service area PDFs, FAQs. The agent cites them when relevant.</LI>
        <LI><Strong>Set up triggers</Strong> for proactive outbound — &ldquo;when a lead enters the nurture pipeline, send a follow-up SMS after 2 hours.&rdquo; All CRM-native.</LI>
      </UL>

      <P>
        When you&apos;re ready, <A href="/login?mode=signup">start building free</A>. No card required during beta.
      </P>
    </>
  )
}
