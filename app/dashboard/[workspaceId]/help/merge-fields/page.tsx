'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { MERGE_FIELDS, type MergeFieldSpec } from '@/lib/merge-fields'

/**
 * Reference page for merge fields. Pulls its field list directly from
 * lib/merge-fields.ts so the catalogue shown here can never drift from
 * what the renderer actually supports — add a new field in one place and
 * it appears here automatically.
 */
export default function MergeFieldsHelpPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const groups: MergeFieldSpec['group'][] = ['Contact', 'Agent', 'User', 'Date']

  return (
    <div className="p-8 max-w-3xl space-y-10">
      <div>
        <Link
          href={`/dashboard/${workspaceId}/help`}
          className="text-xs text-zinc-500 hover:text-white transition-colors"
        >
          ← Help &amp; reference
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100 mt-3">Merge fields</h1>
        <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
          Merge fields let you drop live contact details straight into a pre-written template.
          Write <Mono>Hi {'{{'}contact.first_name{'}}'}</Mono> and at send time the agent
          swaps it for the contact&apos;s real name.
        </p>
      </div>

      {/* ── What they&apos;re for ── */}
      <Section title="When to use them">
        <P>
          Any place the agent sends a <b>pre-written</b> message — something you typed, not
          something the AI wrote. The AI&apos;s own replies don&apos;t need merge fields because
          the agent already has the contact&apos;s data in mind; it personalises naturally.
        </P>
        <ul className="list-disc pl-5 space-y-1 text-sm text-zinc-400">
          <li><b>Follow-up sequences</b> — scheduled messages that wake a contact up</li>
          <li><b>Triggers</b> (fixed-mode) — the first message when a new contact hits a trigger</li>
          <li><b>Voice</b> — the opening line and closing line of a call</li>
          <li><b>Agent fallback</b> — what the agent says when it doesn&apos;t know an answer</li>
          <li><b>Chat widget welcome</b> — the greeting visitors see when they open the widget</li>
        </ul>
      </Section>

      {/* ── Syntax ── */}
      <Section title="Basic syntax">
        <P>
          Wrap the field name in double braces. Dots separate the namespace from the key.
        </P>
        <Example
          template={`Hi {{contact.first_name}}, thanks for reaching out.`}
          rendered={`Hi Ryan, thanks for reaching out.`}
        />
        <P>
          If the token can&apos;t be resolved — the contact doesn&apos;t have a first name,
          or they&apos;re anonymous — it renders as an empty string by default:
        </P>
        <Example
          template={`Hi {{contact.first_name}}, thanks for reaching out.`}
          rendered={`Hi , thanks for reaching out.`}
          label="Without a fallback"
          bad
        />
      </Section>

      {/* ── Fallbacks ── */}
      <Section title="Fallbacks (the | operator)">
        <P>
          Add a pipe and a fallback value. The fallback is used whenever the token is missing
          or empty. This is how you avoid awkward blanks.
        </P>
        <Example
          template={`Hi {{contact.first_name|there}}, thanks for reaching out.`}
          rendered={`Hi there, thanks for reaching out.`}
          label="With a fallback"
        />
        <P>
          Any token supports a fallback — use them liberally when the value might be unknown
          (widget visitors, new leads, calls from unknown numbers).
        </P>
      </Section>

      {/* ── Custom fields ── */}
      <Section title="Custom fields">
        <P>
          Anything you&apos;ve defined as a custom field in GoHighLevel is available by its
          field key, prefixed with <Mono>custom.</Mono>:
        </P>
        <Example
          template={`Your quote is ${'{{'}custom.quote_total|TBD{'}}'}. Valid until {{custom.quote_expires|next week}}.`}
          rendered={`Your quote is $12,500. Valid until 2026-04-27.`}
        />
        <P className="text-xs text-zinc-500">
          Not sure what your custom field keys are? The <Mono>{'{{'}…{'}}'} Insert value</Mono> popover
          on any template lists them alongside the built-ins.
        </P>
      </Section>

      {/* ── Built-in tokens ── */}
      <Section title="All built-in tokens">
        {groups.map(group => (
          <div key={group} className="mb-5 last:mb-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              {group}
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
              {MERGE_FIELDS.filter(f => f.group === group).map(f => (
                <div key={f.token} className="flex items-start gap-4 px-4 py-2.5">
                  <Mono className="text-zinc-300 min-w-[220px]">{f.token}</Mono>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-200">{f.label}</div>
                    {f.example && <div className="text-[11px] text-zinc-600 italic mt-0.5">renders as: {f.example}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Section>

      {/* ── Gotchas ── */}
      <Section title="Good to know">
        <ul className="list-disc pl-5 space-y-2 text-sm text-zinc-400">
          <li>
            <b>Use fallbacks for anything not guaranteed.</b> First names, custom fields, and
            anything from anonymous widget visitors can be empty. A fallback keeps the message
            natural: <Mono>{'{{'}contact.first_name|there{'}}'}</Mono>.
          </li>
          <li>
            <b>Don&apos;t use merge fields in AI instructions.</b> When a trigger is in AI-generate
            mode, or you&apos;re editing the agent&apos;s system prompt, the AI already knows
            who the contact is — writing <Mono>{'{{'}contact.first_name{'}}'}</Mono> there is
            redundant and will ship literal braces if the AI copies it.
          </li>
          <li>
            <b>Unknown tokens render empty.</b> If you type <Mono>{'{{'}contact.made_up{'}}'}</Mono>
            by mistake, it renders as an empty string (or your fallback if you provided one).
            The raw braces are never left in the output.
          </li>
          <li>
            <b>Dates respect the agent&apos;s timezone.</b> If you set a timezone on the agent,
            <Mono>{'{{'}date.today{'}}'}</Mono> renders in that timezone — useful for bookings.
          </li>
          <li>
            <b>Voice calls from unknown numbers.</b> If the caller isn&apos;t in your CRM, the
            <Mono>contact.*</Mono> tokens will hit their fallbacks. Write openers with that in mind
            (e.g. <Mono>Hi {'{{'}contact.first_name|friend{'}}'}</Mono>).
          </li>
        </ul>
      </Section>

      {/* ── Cheat sheet ── */}
      <Section title="Cheat sheet">
        <pre className="bg-zinc-950 border border-zinc-800 rounded-lg p-4 text-xs text-zinc-300 overflow-x-auto leading-relaxed">
{`Hi {{contact.first_name|there}},

Thanks for your interest in {{custom.service_interest|our services}}.
Your quote total is \${{custom.quote_total|TBD}} — valid through {{date.tomorrow}}.

Ready to lock it in? Just reply here.

— {{agent.name|the team}}`}
        </pre>
      </Section>
    </div>
  )
}

// ── Tiny internal helpers (kept local to avoid a new components file) ────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-zinc-100 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-sm text-zinc-400 leading-relaxed ${className ?? ''}`}>{children}</p>
}

function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={`font-mono text-[12px] bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-300 ${className ?? ''}`}>
      {children}
    </code>
  )
}

function Example({
  template,
  rendered,
  label,
  bad,
}: {
  template: string
  rendered: string
  label?: string
  bad?: boolean
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      {label && (
        <div className={`px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b border-zinc-800 ${
          bad ? 'text-amber-400 bg-amber-500/5' : 'text-emerald-400 bg-emerald-500/5'
        }`}>
          {label}
        </div>
      )}
      <div className="px-4 py-3 space-y-1">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Template</div>
        <div className="font-mono text-xs text-zinc-300 whitespace-pre-wrap break-all">{template}</div>
      </div>
      <div className="border-t border-zinc-900 px-4 py-3 space-y-1 bg-zinc-900/40">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider">At send time</div>
        <div className={`font-mono text-xs whitespace-pre-wrap break-words ${bad ? 'text-amber-300' : 'text-zinc-200'}`}>
          {rendered}
        </div>
      </div>
    </div>
  )
}
