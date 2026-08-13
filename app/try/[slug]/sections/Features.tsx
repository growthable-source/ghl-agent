function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}
function BrainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5c-2.07 0-3.75 1.68-3.75 3.75 0 .38.06.75.16 1.1A3.375 3.375 0 006 12.75c0 1.36.83 2.53 2.01 3.02a3.376 3.376 0 003.24 4.23h1.5a3.376 3.376 0 003.24-4.23A3.373 3.373 0 0018 12.75a3.375 3.375 0 00-2.41-3.4c.1-.35.16-.72.16-1.1 0-2.07-1.68-3.75-3.75-3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9v9M14.25 9v9" />
    </svg>
  )
}
function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}
function TransferIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5M16.5 3L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  )
}
function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m-7 5h8a2 2 0 002-2V6.5a2 2 0 00-2-2h-1.5a1.5 1.5 0 00-1.415-2.121A1.5 1.5 0 0011.5.75h-1a1.5 1.5 0 00-1.415 1.629A1.5 1.5 0 007.5 4.5H6a2 2 0 00-2 2V19a2 2 0 002 2z" />
    </svg>
  )
}
function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18zM3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 000 18M12.5 3a17 17 0 010 18" />
    </svg>
  )
}

import type { DemoBrand, BrandFeatureIcon } from '@/lib/demo-brands'

/** Icon components keyed by the string the brand config carries — keeps
 *  lib/demo-brands serializable across the server→client boundary. */
const ICONS: Record<BrandFeatureIcon, () => React.JSX.Element> = {
  bolt: BoltIcon,
  brain: BrainIcon,
  calendar: CalendarIcon,
  transfer: TransferIcon,
  clipboard: ClipboardIcon,
  globe: GlobeIcon,
}

export default function Features({ brand }: { brand: DemoBrand }) {
  return (
    <section id="features" className="py-16 sm:py-24 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-12 sm:mb-16">
          <span className="section-label inline-block mb-4">{brand.copy.featuresLabel}</span>
          <h2 className="font-black tracking-tight mb-4" style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', color: 'var(--text-primary)' }}>
            {brand.copy.featuresHeading}
          </h2>
          <p className="max-w-md mx-auto" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
            {brand.copy.featuresSub}
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {brand.features.map(({ icon, title, body }) => {
            const Icon = ICONS[icon]
            return (
            <div key={title} className="vox-card p-6">
              <div className="icon-box mb-4">
                <Icon />
              </div>
              <h3 className="font-bold text-[17px] mb-2" style={{ color: 'var(--text-primary)' }}>{title}</h3>
              <p className="text-sm leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{body}</p>
            </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
