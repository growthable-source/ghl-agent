import type { DemoBrand } from '@/lib/demo-brands'

export default function Stats({ brand }: { brand: DemoBrand }) {
  return (
    <section className="py-14 sm:py-20 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
        {brand.stats.map(s => (
          <div key={s.label} className="vox-card px-6 py-8 text-center">
            {/* .stat-value is a fixed 2.25rem, sized for punchy values like
                "< 1s". Word-length values ("Since 1986", "Nationwide") blow
                out the card at that size, so anything long steps down. */}
            <div
              className="stat-value mb-1.5"
              style={s.value.length > 7 ? { fontSize: 'clamp(1.15rem, 3.2vw, 1.6rem)' } : undefined}
            >
              {s.value}
            </div>
            <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
