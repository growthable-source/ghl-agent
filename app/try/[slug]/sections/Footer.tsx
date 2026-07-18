import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'

export default function Footer({
  businessName,
  onShare,
  shareCopied,
}: {
  businessName: string
  onShare: () => void
  shareCopied: boolean
}) {
  return (
    <footer className="border-t py-8 px-6" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <div className="flex items-center gap-3">
          <XoveraLogo height={16} />
          <span>
            Demo built by <Link href="/" className="underline hover:no-underline">Xovera</Link>. Not affiliated with or endorsed by {businessName}.
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/privacy" className="transition-colors hover:text-[var(--text-primary)]">Privacy</Link>
          <Link href="/terms" className="transition-colors hover:text-[var(--text-primary)]">Terms</Link>
          <button type="button" onClick={onShare} className="transition-colors hover:text-[var(--text-primary)]">
            {shareCopied ? 'Link copied!' : '↗ Share this demo'}
          </button>
        </div>
      </div>
    </footer>
  )
}
