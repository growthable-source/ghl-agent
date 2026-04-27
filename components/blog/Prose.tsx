import type { ReactNode } from 'react'

/**
 * Typographic primitives shared across every blog post. Written as
 * plain React components (not MDX plugins, not a prose-class) so each
 * post is just a regular TSX file importing from here — type-safe,
 * no config to maintain.
 *
 * Design language mirrors the landing page: navy background, readable
 * off-white body, orange accent for strong emphasis. Max-width on the
 * article itself (not here) keeps line length in the 65–75 char range
 * that reads best.
 */

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-2xl md:text-3xl font-bold tracking-tight mt-14 mb-5" style={{ color: '#f8fafc' }}>
      {children}
    </h2>
  )
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="scroll-mt-24 text-xl font-semibold mt-10 mb-3" style={{ color: '#f8fafc' }}>
      {children}
    </h3>
  )
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-5 leading-[1.75] text-[1.0625rem]" style={{ color: '#cbd5e1' }}>{children}</p>
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="text-xl leading-[1.6] mb-8" style={{ color: '#94a3b8' }}>{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="my-5 ml-5 list-disc space-y-2 leading-[1.75] text-[1.0625rem] marker:text-[#fa4d2e]" style={{ color: '#cbd5e1' }}>{children}</ul>
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="my-5 ml-6 list-decimal space-y-2 leading-[1.75] text-[1.0625rem] marker:text-[#fa4d2e] marker:font-semibold" style={{ color: '#cbd5e1' }}>{children}</ol>
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="pl-1">{children}</li>
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold" style={{ color: '#f8fafc' }}>{children}</strong>
}

export function Em({ children }: { children: ReactNode }) {
  return <em className="italic" style={{ color: '#f8fafc' }}>{children}</em>
}

export function A({ children, href }: { children: ReactNode; href: string }) {
  const isExternal = /^https?:\/\//.test(href)
  return (
    <a
      href={href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className="underline decoration-[#fa4d2e]/40 hover:decoration-[#fa4d2e] underline-offset-2 transition-colors"
      style={{ color: '#fa4d2e' }}
    >
      {children}
    </a>
  )
}

export function Code({ children }: { children: ReactNode }) {
  return <code className="rounded px-1.5 py-0.5 font-mono text-[0.9em]" style={{ background: 'rgba(250,77,46,0.1)', color: '#fb8e6a' }}>{children}</code>
}

export function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="my-6 overflow-x-auto rounded-lg p-5 text-sm leading-[1.6] font-mono border" style={{ background: '#0a0f1a', borderColor: '#121a2b', color: '#cbd5e1' }}>
      {children}
    </pre>
  )
}

export function Callout({ children, title, tone = 'accent' }: {
  children: ReactNode
  title?: string
  tone?: 'accent' | 'warn' | 'info'
}) {
  const tint = tone === 'warn'
    ? { border: 'rgba(251,191,36,0.3)', bg: 'rgba(251,191,36,0.05)', label: '#fbbf24' }
    : tone === 'info'
    ? { border: 'rgba(96,165,250,0.3)', bg: 'rgba(96,165,250,0.05)', label: '#60a5fa' }
    : { border: 'rgba(250,77,46,0.3)', bg: 'rgba(250,77,46,0.05)', label: '#fa4d2e' }
  return (
    <div className="my-8 rounded-lg border p-5" style={{ borderColor: tint.border, background: tint.bg }}>
      {title && (
        <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: tint.label }}>
          {title}
        </div>
      )}
      <div className="text-[0.975rem] leading-[1.7]" style={{ color: '#cbd5e1' }}>{children}</div>
    </div>
  )
}

export function Blockquote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="my-8 border-l-4 pl-5 italic text-[1.0625rem] leading-[1.7]" style={{ borderColor: '#fa4d2e', color: '#94a3b8' }}>
      {children}
    </blockquote>
  )
}

export function HR() {
  return <hr className="my-12 border-0 h-px" style={{ background: '#121a2b' }} />
}
