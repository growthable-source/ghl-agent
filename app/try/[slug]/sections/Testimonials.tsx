import type { DemoBrand } from '@/lib/demo-brands'
import TestimonialAvatar from './TestimonialAvatar'

/**
 * Social proof. Content comes from the brand config (lib/demo-brands), not
 * from a constant here, because whitelabel landers must show THEIR OWN
 * customers — never Xovera's. The section label is brand-controlled for the
 * same reason: ASC's quotes are real dealer testimonials about ASC's
 * service-contract business, so their label says exactly that rather than
 * implying a dealer reviewed the AI receptionist.
 */
export default function Testimonials({ brand }: { brand: DemoBrand }) {
  return (
    <section id="reviews" className="py-16 sm:py-24 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-12 sm:mb-14">
          <span className="section-label inline-block mb-4">{brand.copy.testimonialsLabel}</span>
          <h2
            className="font-black tracking-tight whitespace-pre-line"
            style={{ fontSize: 'clamp(1.6rem, 3.6vw, 2.75rem)', color: 'var(--text-primary)' }}
          >
            {brand.copy.testimonialsHeading}
          </h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {brand.testimonials.map(t => (
            <div key={t.name + t.role} className="vox-card p-7">
              <p className="mb-3.5 text-sm" style={{ color: 'var(--accent-amber)' }}>★★★★★</p>
              <p className="italic text-[15px] leading-[1.65] mb-5" style={{ color: 'var(--text-secondary)' }}>&ldquo;{t.quote}&rdquo;</p>
              <div className="flex items-center gap-3">
                <TestimonialAvatar testimonial={t} size={36} />
                <div>
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
