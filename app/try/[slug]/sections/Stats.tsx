const STATS = [
  { value: '< 1s', label: 'Answer time, guaranteed' },
  { value: '24/7', label: '365 days, no exceptions' },
  { value: '100%', label: 'Call answer rate' },
  { value: '2.4k+', label: 'Businesses already live' },
]

export default function Stats() {
  return (
    <section className="py-14 sm:py-20 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
        {STATS.map(s => (
          <div key={s.label} className="vox-card px-6 py-8 text-center">
            <div className="stat-value mb-1.5">{s.value}</div>
            <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
