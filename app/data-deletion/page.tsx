import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'

export const metadata = {
  title: 'Data Deletion | Xovera',
  description: 'How to request deletion of your Xovera account data, including data obtained through connected platforms like Facebook and Instagram.',
}

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}>
      <header className="sticky top-0 z-50 border-b backdrop-blur-xl" style={{ borderColor: 'var(--border)', background: 'rgba(5,8,15,0.85)' }}>
        <div className="max-w-[1280px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <XoveraLogo variant="mark" height={26} />
            <span className="font-bold text-sm">Xovera</span>
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/docs" className="hover:text-white transition-colors" style={{ color: 'var(--text-secondary)' }}>Docs</Link>
            <Link href="/login" className="btn-primary text-sm py-2 px-5">Log in</Link>
          </div>
        </div>
      </header>

      <section className="relative py-20 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(250,77,46,0.08), transparent 50%)' }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <span className="section-label inline-block mb-4">Data Deletion</span>
          <h1 className="font-bold tracking-tight mb-4" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)' }}>
            How to delete <span className="text-gradient">your data</span>
          </h1>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            You can request deletion of any data Xovera holds about you at any time. Here&apos;s how.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="vox-card p-6 rounded-xl">
            <h2 className="font-semibold text-base mb-3">Request deletion by email</h2>
            <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
              Email <a href="mailto:support@xovera.io?subject=Data%20Deletion%20Request" className="text-gradient font-medium">support@xovera.io</a> from
              the address associated with your Xovera account, with the subject line <strong>&ldquo;Data Deletion Request&rdquo;</strong>.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Include the workspace name and any connected platform (Facebook Page, Instagram account, CRM)
              you want disconnected. We&apos;ll confirm receipt within 2 business days and complete deletion
              within 30 days.
            </p>
          </div>

          <div className="vox-card p-6 rounded-xl">
            <h2 className="font-semibold text-base mb-3">What gets deleted</h2>
            <ul className="text-sm leading-relaxed space-y-2 list-disc pl-5" style={{ color: 'var(--text-secondary)' }}>
              <li>Your account profile and login credentials</li>
              <li>All workspaces, agents, and conversation history you created</li>
              <li>Contacts, leads, and message logs synced from connected CRMs</li>
              <li>Pages, Instagram accounts, and access tokens obtained from Meta</li>
              <li>Any uploaded knowledge-base content, recordings, or transcripts</li>
            </ul>
          </div>

          <div className="vox-card p-6 rounded-xl">
            <h2 className="font-semibold text-base mb-3">Disconnecting Facebook or Instagram only</h2>
            <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--text-secondary)' }}>
              If you only want to revoke Xovera&apos;s access to your Facebook or Instagram data without
              deleting your Xovera account, you can do this directly inside Facebook:
            </p>
            <ol className="text-sm leading-relaxed space-y-1 list-decimal pl-5" style={{ color: 'var(--text-secondary)' }}>
              <li>Go to <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener noreferrer" className="underline">Facebook Settings &rarr; Business Integrations</a></li>
              <li>Find <strong>Xovera</strong> in the list of connected apps</li>
              <li>Click <strong>Remove</strong> &mdash; this revokes all tokens immediately</li>
            </ol>
            <p className="text-sm leading-relaxed mt-3" style={{ color: 'var(--text-secondary)' }}>
              When you revoke access this way, Xovera receives a deauthorization webhook from Meta and
              automatically purges the Page tokens and any cached Page metadata associated with that
              connection. Conversation history with end users on those Pages is retained unless you also
              email us a deletion request as described above.
            </p>
          </div>

          <div className="vox-card p-6 rounded-xl">
            <h2 className="font-semibold text-base mb-3">Retention exceptions</h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              We may retain limited information if required to comply with legal obligations, resolve
              disputes, or enforce our agreements &mdash; for example, billing records and audit logs.
              Anything retained for these reasons is access-restricted and deleted as soon as the
              underlying obligation expires.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <XoveraLogo height={16} />
          <div className="flex items-center gap-6">
            <Link href="/docs" className="hover:text-white transition-colors">Docs</Link>
            <Link href="/support" className="hover:text-white transition-colors">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
