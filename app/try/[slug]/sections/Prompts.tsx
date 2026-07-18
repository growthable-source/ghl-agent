export default function Prompts({
  businessName,
  chips,
  disabled,
  onPick,
}: {
  businessName: string
  chips: string[]
  disabled: boolean
  onPick: () => void
}) {
  return (
    <section className="py-16 sm:py-24 px-6 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-3xl mx-auto text-center">
        <span className="section-label inline-block mb-4">Demo prompts</span>
        <h2 className="font-black tracking-tight mb-4" style={{ fontSize: 'clamp(1.6rem, 3.6vw, 2.75rem)', color: 'var(--text-primary)' }}>
          Ask it anything you&rsquo;d ask a receptionist.
        </h2>
        <p className="mb-9" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          The demo is trained on {businessName}. Click any prompt to start — or make up your own.
        </p>

        <div className="flex flex-wrap justify-center gap-2.5">
          {chips.map(chip => (
            <button
              key={chip}
              type="button"
              onClick={onPick}
              disabled={disabled}
              className="vox-card px-5 py-3 text-[13px] font-semibold rounded-full transition disabled:opacity-40 disabled:cursor-not-allowed hover:-translate-y-0.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              &ldquo;{chip}&rdquo;
            </button>
          ))}
        </div>

        <p className="mt-8 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Ready to use it for your own business?{' '}
          <a href="#try-website-input" className="font-medium" style={{ color: 'var(--accent-primary)' }}>
            Paste your URL above →
          </a>
        </p>
      </div>
    </section>
  )
}
