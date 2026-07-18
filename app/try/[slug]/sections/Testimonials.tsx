import Image from 'next/image'

const TESTIMONIALS = [
  {
    quote: "Feels eerily real. Our customers genuinely thought it was a person. We've not missed a single call in 4 months.",
    name: 'Luke M.',
    role: 'Café Owner, Melbourne',
    avatar: '/try-demo/avatar-luke-m.jpg',
  },
  {
    quote: 'We were losing bookings every weekend. Now the AI handles overflow perfectly. Revenue is up 22%.',
    name: 'Sarah K.',
    role: 'Salon Owner, Sydney',
    avatar: '/try-demo/avatar-5.jpg',
  },
  {
    quote: 'Set up in 90 seconds. It already knew our menu, hours, and could handle reservations. I was floored.',
    name: 'Marco T.',
    role: 'Restaurant Manager, Brisbane',
    avatar: '/try-demo/avatar-marco-t.jpg',
  },
]

export default function Testimonials() {
  return (
    <section id="reviews" className="py-16 sm:py-24 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-12 sm:mb-14">
          <span className="section-label inline-block mb-4">Real businesses. Real results.</span>
          <h2 className="font-black tracking-tight" style={{ fontSize: 'clamp(1.6rem, 3.6vw, 2.75rem)', color: 'var(--text-primary)' }}>
            They stopped missing calls.<br />You should too.
          </h2>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {TESTIMONIALS.map(t => (
            <div key={t.name} className="vox-card p-7">
              <p className="mb-3.5 text-sm" style={{ color: 'var(--accent-amber)' }}>★★★★★</p>
              <p className="italic text-[15px] leading-[1.65] mb-5" style={{ color: 'var(--text-secondary)' }}>&ldquo;{t.quote}&rdquo;</p>
              <div className="flex items-center gap-3">
                <div className="relative w-9 h-9 rounded-full overflow-hidden shrink-0">
                  <Image src={t.avatar} alt="" width={36} height={36} className="object-cover w-full h-full" />
                </div>
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
