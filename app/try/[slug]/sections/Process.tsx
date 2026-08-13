import type { DemoBrand } from '@/lib/demo-brands'

export default function Process({ brand }: { brand: DemoBrand }) {
  return (
    <section id="how-it-works" className="py-16 sm:py-24 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-14 sm:mb-16">
          <span className="section-label inline-block mb-4">{brand.copy.processLabel}</span>
          <h2 className="font-black tracking-tight mb-4" style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', color: 'var(--text-primary)' }}>
            {brand.copy.processHeading}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>{brand.copy.processSub}</p>
        </div>

        <div className="relative grid sm:grid-cols-3 gap-10 sm:gap-6">
          <div
            className="hidden sm:block absolute left-[16.6%] right-[16.6%] top-[39px] h-px"
            style={{ background: 'linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--accent-primary) 40%, transparent) 25%, color-mix(in srgb, var(--accent-primary) 30%, transparent) 50%, color-mix(in srgb, var(--accent-primary) 40%, transparent) 75%, transparent 100%)' }}
          />
          {brand.steps.map(s => (
            <div key={s.n} className="flex flex-col items-center text-center px-4">
              <div className="vox-card w-[78px] h-[78px] rounded-full flex items-center justify-center relative z-10 mb-4">
                <span className="font-black text-xl" style={{ color: 'var(--accent-primary)' }}>{s.n}</span>
              </div>
              <h3 className="font-bold text-[19px] mb-2" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
              <p className="text-sm leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
