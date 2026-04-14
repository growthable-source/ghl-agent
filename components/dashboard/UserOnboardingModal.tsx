'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import VoxilityLogo from '@/components/VoxilityLogo'

const SIZES = [
  { value: '1', label: 'Solo' },
  { value: '2-10', label: '2–10' },
  { value: '11-50', label: '11–50' },
  { value: '51-200', label: '51–200' },
  { value: '201-1000', label: '201–1,000' },
  { value: '1000+', label: '1,000+' },
]

const ROLES = [
  { value: 'founder', label: 'Founder / CEO' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'sales', label: 'Sales' },
  { value: 'operations', label: 'Operations' },
  { value: 'developer', label: 'Developer' },
  { value: 'agency', label: 'Agency Owner' },
  { value: 'other', label: 'Other' },
]

const STEP_LABELS = ['Profile', 'CRM', 'Get Started']

type CrmChoice = 'ghl' | 'none' | 'other' | null

export default function UserOnboardingModal() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showBooking, setShowBooking] = useState(false)

  // Form state
  const [companyName, setCompanyName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [role, setRole] = useState('')
  const [crmChoice, setCrmChoice] = useState<CrmChoice>(null)

  async function completeOnboarding() {
    setSaving(true)
    try {
      await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, companySize, role }),
      })
      router.refresh()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl p-8"
        style={{
          background: 'var(--gradient-card, linear-gradient(135deg, #090d15, #0c111d))',
          border: '1px solid var(--border, #121a2b)',
        }}
      >
        {/* ─── Progress indicator ─── */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEP_LABELS.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors"
                style={
                  i < step
                    ? { background: 'var(--accent-primary, #fa4d2e)', color: '#fff' }
                    : i === step
                    ? { background: 'var(--accent-primary-bg, rgba(250,77,46,0.15))', color: 'var(--accent-primary, #fa4d2e)', border: '1.5px solid var(--accent-primary, #fa4d2e)' }
                    : { background: 'var(--surface-secondary, #0f1524)', color: 'var(--text-muted, #475569)' }
                }
              >
                {i < step ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className="w-10 h-px"
                  style={{ background: i < step ? 'var(--accent-primary, #fa4d2e)' : 'var(--border, #121a2b)' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* ═══ Step 0 — Profile ═══ */}
        {step === 0 && (
          <div className="space-y-6">
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <VoxilityLogo variant="mark" height={40} />
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                Welcome to <span className="text-gradient">Voxility</span>
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Tell us a bit about you so we can set things up.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                  Company name
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Inc."
                  className="w-full h-10 px-3 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--input-bg, #0f1524)',
                    border: '1px solid var(--input-border, #1a2540)',
                    color: 'var(--input-text, #f8fafc)',
                  }}
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                  Company size
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {SIZES.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setCompanySize(s.value)}
                      className="h-9 rounded-lg text-sm font-medium transition-all"
                      style={
                        companySize === s.value
                          ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary, #fa4d2e)', border: '1px solid var(--accent-primary, #fa4d2e)' }
                          : { background: 'var(--surface-secondary, #0f1524)', color: 'var(--text-secondary, #94a3b8)', border: '1px solid var(--border, #121a2b)' }
                      }
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                  Your role
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg text-sm outline-none transition-colors appearance-none"
                  style={{
                    background: 'var(--input-bg, #0f1524)',
                    border: '1px solid var(--input-border, #1a2540)',
                    color: role ? 'var(--input-text, #f8fafc)' : 'var(--text-muted, #475569)',
                  }}
                >
                  <option value="" disabled>Select your role</option>
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={() => setStep(1)}
              className="btn-primary w-full justify-center"
            >
              Continue
            </button>
          </div>
        )}

        {/* ═══ Step 1 — CRM ═══ */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                Do you use a CRM?
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Voxility works best when connected to your CRM.
              </p>
            </div>

            <div className="space-y-3">
              <CrmCard
                selected={crmChoice === 'ghl'}
                onClick={() => setCrmChoice('ghl')}
                title="I use GoHighLevel"
                desc="Connect via our GHL Marketplace integration after setup."
              />
              <CrmCard
                selected={crmChoice === 'other'}
                onClick={() => setCrmChoice('other')}
                title="I use another CRM"
                desc="HubSpot support is coming soon. You can still use Voxility standalone."
              />
              <CrmCard
                selected={crmChoice === 'none'}
                onClick={() => setCrmChoice('none')}
                title="I don't have a CRM"
                desc="No problem — you can use Voxility standalone."
              />
            </div>

            {/* GHL trial callout */}
            {crmChoice === 'none' && (
              <div
                className="rounded-lg p-4"
                style={{
                  background: 'var(--accent-primary-bg, rgba(250,77,46,0.15))',
                  border: '1px solid rgba(250,77,46,0.25)',
                }}
              >
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                  Try GoHighLevel free for 30 days
                </p>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                  GoHighLevel is the CRM that powers most Voxility users. Get a free trial to unlock the full experience.
                </p>
                <a
                  href="https://www.gohighlevel.com/?fp_ref=voxility"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
                  style={{ color: 'var(--accent-primary, #fa4d2e)' }}
                >
                  Start free trial
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(0)}
                className="btn-secondary flex-1 justify-center"
              >
                Back
              </button>
              <button
                onClick={() => setStep(2)}
                className="btn-primary flex-1 justify-center"
                disabled={!crmChoice}
                style={!crmChoice ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 2 — Get started ═══ */}
        {step === 2 && !showBooking && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                How would you like to get started?
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Build your first agent yourself, or let us help.
              </p>
            </div>

            <div className="space-y-3">
              {/* Build it myself */}
              <button
                onClick={completeOnboarding}
                disabled={saving}
                className="w-full text-left rounded-xl p-5 transition-all group"
                style={{
                  background: 'var(--surface-secondary, #0f1524)',
                  border: '1px solid var(--border, #121a2b)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary, #fa4d2e)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border, #121a2b)' }}
              >
                <div className="flex items-start gap-4">
                  <div className="icon-box shrink-0 mt-0.5">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                      Build it myself
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                      Jump straight into your workspace and create your first AI agent. Takes about 5 minutes.
                    </p>
                  </div>
                </div>
              </button>

              {/* Book onboarding call */}
              <button
                onClick={() => setShowBooking(true)}
                disabled={saving}
                className="w-full text-left rounded-xl p-5 transition-all"
                style={{
                  background: 'var(--surface-secondary, #0f1524)',
                  border: '1px solid var(--border, #121a2b)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary, #fa4d2e)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border, #121a2b)' }}
              >
                <div className="flex items-start gap-4">
                  <div className="icon-box shrink-0 mt-0.5">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                      Book an onboarding call
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                      Schedule a call with our customer success team. We&apos;ll set everything up together.
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <button
              onClick={() => setStep(1)}
              className="btn-secondary w-full justify-center"
            >
              Back
            </button>
          </div>
        )}

        {/* ═══ Step 2b — Booking view ═══ */}
        {step === 2 && showBooking && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                Book your onboarding call
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Pick a time that works for you.
              </p>
            </div>

            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--border, #121a2b)' }}
            >
              <iframe
                src="https://crm.voxility.ai/widget/bookings/voxility-conversational-ai-onb"
                className="w-full border-0"
                style={{ height: '500px', background: 'var(--surface, #090d15)' }}
                title="Book onboarding call"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowBooking(false)}
                className="btn-secondary flex-1 justify-center"
              >
                Back
              </button>
              <button
                onClick={completeOnboarding}
                disabled={saving}
                className="btn-primary flex-1 justify-center"
              >
                {saving ? 'Saving...' : "I'm all set"}
              </button>
            </div>

            <button
              onClick={completeOnboarding}
              disabled={saving}
              className="w-full text-center text-xs font-medium transition-colors"
              style={{ color: 'var(--text-muted, #475569)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary, #94a3b8)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted, #475569)' }}
            >
              I&apos;ll book later
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Reusable CRM selection card ─── */
function CrmCard({
  selected,
  onClick,
  title,
  desc,
}: {
  selected: boolean
  onClick: () => void
  title: string
  desc: string
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl p-4 transition-all"
      style={
        selected
          ? {
              background: 'var(--accent-primary-bg, rgba(250,77,46,0.15))',
              border: '1px solid var(--accent-primary, #fa4d2e)',
            }
          : {
              background: 'var(--surface-secondary, #0f1524)',
              border: '1px solid var(--border, #121a2b)',
            }
      }
    >
      <div className="flex items-center gap-3">
        <div
          className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
          style={{
            borderColor: selected ? 'var(--accent-primary, #fa4d2e)' : 'var(--border-secondary, #1f2b47)',
          }}
        >
          {selected && (
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-primary, #fa4d2e)' }} />
          )}
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary, #f8fafc)' }}>{title}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>{desc}</p>
        </div>
      </div>
    </button>
  )
}
