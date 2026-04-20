'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import VoxilityLogo from '@/components/VoxilityLogo'

// ─── Constants ───────────────────────────────────────────────────────────────

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'outlook.com',
  'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com',
  'mac.com', 'protonmail.com', 'proton.me', 'zoho.com', 'mail.com',
  'yandex.com', 'fastmail.com', 'tutanota.com',
])

const ADJECTIVES = [
  'Swift', 'Bright', 'Silent', 'Bold', 'Calm', 'Clever', 'Cosmic',
  'Crystal', 'Golden', 'Lunar', 'Neon', 'Noble', 'Rapid', 'Stellar',
  'Vivid', 'Arctic', 'Ember', 'Iron', 'Jade', 'Marble', 'Onyx',
  'Pearl', 'Quantum', 'Velvet', 'Coral', 'Dusk', 'Echo', 'Frost',
]
const NOUNS = [
  'Owl', 'Fox', 'Hawk', 'Wolf', 'Bear', 'Lynx', 'Crane', 'Eagle',
  'Falcon', 'Heron', 'Jaguar', 'Panther', 'Raven', 'Sparrow', 'Tiger',
  'Badger', 'Cobra', 'Dolphin', 'Elk', 'Gecko', 'Ibis', 'Koala',
  'Mantis', 'Orca', 'Puma', 'Quail', 'Stag', 'Viper',
]

const WORKSPACE_ICONS = [
  '🚀', '⚡', '🎯', '💎', '🔥', '🌊', '🏔️', '🌿',
  '🦊', '🦅', '🐺', '🦁', '🐻', '🦉', '🐬', '🦈',
  '🏢', '🏗️', '🎨', '🔬', '💡', '🛡️', '⭐', '🌙',
]

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

const STEP_LABELS = ['Workspace', 'Profile', 'Team', 'Get Started']

type CrmChoice = 'ghl' | 'none' | 'other' | null

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj} ${noun}`
}

function domainToName(domain: string): string {
  // "acme-corp.com.au" → "Acme Corp"
  const base = domain.split('.')[0]
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function extractDomain(email: string): string | null {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain || PERSONAL_DOMAINS.has(domain)) return null
  return domain
}

function randomIcon() {
  return WORKSPACE_ICONS[Math.floor(Math.random() * WORKSPACE_ICONS.length)]
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  userEmail?: string
  userName?: string
}

export default function UserOnboardingModal({ userEmail, userName }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [showBooking, setShowBooking] = useState(false)

  // Derive smart defaults from email
  const emailDomain = useMemo(() => userEmail ? extractDomain(userEmail) : null, [userEmail])

  const defaultName = useMemo(() => {
    if (emailDomain) return domainToName(emailDomain)
    return generateRandomName()
  }, [emailDomain])

  // Step 0 — Workspace
  const [workspaceName, setWorkspaceName] = useState(defaultName)
  const [workspaceIcon, setWorkspaceIcon] = useState(randomIcon)
  const [showIconPicker, setShowIconPicker] = useState(false)

  // Step 1 — Profile
  const [companyName, setCompanyName] = useState('')
  const [companySize, setCompanySize] = useState('')
  const [role, setRole] = useState('')

  // Step 2 — Invite
  const [inviteInput, setInviteInput] = useState('')
  const [inviteEmails, setInviteEmails] = useState<string[]>([])
  const [inviting, setInviting] = useState(false)
  const [inviteResults, setInviteResults] = useState<{ email: string; status: string; crossDomain: boolean }[]>([])

  function addInviteEmail() {
    const email = inviteInput.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    if (inviteEmails.includes(email)) return
    if (email === userEmail?.toLowerCase()) return
    setInviteEmails(prev => [...prev, email])
    setInviteInput('')
  }

  function removeInviteEmail(email: string) {
    setInviteEmails(prev => prev.filter(e => e !== email))
  }

  function isEmailCrossDomain(email: string): boolean {
    if (!emailDomain) return false
    return email.split('@')[1] !== emailDomain
  }

  async function completeOnboarding() {
    if (!workspaceName.trim()) return
    setSaving(true)
    try {
      // 1. Create the workspace
      const wsRes = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: workspaceName.trim(),
          icon: workspaceIcon,
          domain: emailDomain,
        }),
      })
      const wsData = await wsRes.json()
      if (!wsRes.ok) throw new Error(wsData.error || 'Failed to create workspace')

      // 2. Send invites if any
      if (inviteEmails.length > 0) {
        await fetch(`/api/workspaces/${wsData.workspaceId}/invites`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: inviteEmails }),
        })
      }

      // 3. Save user profile + mark onboarding complete
      await fetch('/api/user/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, companySize, role }),
      })

      // 4. Navigate to the new-agent wizard. New users finish onboarding
      //    expecting to build their first agent — the dashboard overview
      //    isn't a useful landing when there's nothing to look at yet.
      router.push(`/dashboard/${wsData.workspaceId}/agents/new`)
      router.refresh()
    } catch (err) {
      console.error('Onboarding error:', err)
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
                  className="w-8 h-px"
                  style={{ background: i < step ? 'var(--accent-primary, #fa4d2e)' : 'var(--border, #121a2b)' }}
                />
              )}
            </div>
          ))}
        </div>

        {/* ═══ Step 0 — Workspace ═══ */}
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
                {userName ? `Hey ${userName.split(' ')[0]}! ` : ''}Let&apos;s set up your workspace.
              </p>
            </div>

            {/* Icon + Name row */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Workspace
              </label>
              <div className="flex items-center gap-3">
                {/* Icon button */}
                <button
                  type="button"
                  onClick={() => setShowIconPicker(!showIconPicker)}
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 transition-colors"
                  style={{
                    background: 'var(--input-bg, #0f1524)',
                    border: '1px solid var(--input-border, #1a2540)',
                  }}
                  title="Choose icon"
                >
                  {workspaceIcon}
                </button>
                {/* Name input */}
                <input
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Workspace name"
                  autoFocus
                  className="w-full h-10 px-3 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--input-bg, #0f1524)',
                    border: '1px solid var(--input-border, #1a2540)',
                    color: 'var(--input-text, #f8fafc)',
                  }}
                />
              </div>

              {/* Icon picker grid */}
              {showIconPicker && (
                <div
                  className="mt-2 p-3 rounded-lg grid grid-cols-8 gap-1"
                  style={{
                    background: 'var(--surface-secondary, #0f1524)',
                    border: '1px solid var(--border, #121a2b)',
                  }}
                >
                  {WORKSPACE_ICONS.map(icon => (
                    <button
                      key={icon}
                      onClick={() => { setWorkspaceIcon(icon); setShowIconPicker(false) }}
                      className="w-8 h-8 rounded-md flex items-center justify-center text-lg transition-colors hover:bg-white/10"
                      style={
                        workspaceIcon === icon
                          ? { background: 'var(--accent-primary-bg)', border: '1px solid var(--accent-primary, #fa4d2e)' }
                          : {}
                      }
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              )}

              {emailDomain && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted, #475569)' }}>
                  Auto-detected from <span style={{ color: 'var(--text-secondary, #94a3b8)' }}>{emailDomain}</span>
                </p>
              )}
              {!emailDomain && (
                <p className="text-xs mt-2" style={{ color: 'var(--text-muted, #475569)' }}>
                  You can rename this anytime.
                </p>
              )}
            </div>

            <button
              onClick={() => setStep(1)}
              disabled={!workspaceName.trim()}
              className="btn-primary w-full justify-center"
              style={!workspaceName.trim() ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            >
              Continue
            </button>
          </div>
        )}

        {/* ═══ Step 1 — Profile ═══ */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                Tell us about you
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                This helps us personalize your experience.
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
                  placeholder={workspaceName || 'Acme Inc.'}
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

            <div className="flex gap-3">
              <button onClick={() => setStep(0)} className="btn-secondary flex-1 justify-center">Back</button>
              <button onClick={() => setStep(2)} className="btn-primary flex-1 justify-center">Continue</button>
            </div>
          </div>
        )}

        {/* ═══ Step 2 — Invite Team ═══ */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                Invite your team
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Add teammates to collaborate on agents and conversations.
              </p>
            </div>

            {/* Email input */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Email address
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={inviteInput}
                  onChange={(e) => setInviteInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addInviteEmail() } }}
                  placeholder={emailDomain ? `colleague@${emailDomain}` : 'colleague@company.com'}
                  className="w-full h-10 px-3 rounded-lg text-sm outline-none transition-colors"
                  style={{
                    background: 'var(--input-bg, #0f1524)',
                    border: '1px solid var(--input-border, #1a2540)',
                    color: 'var(--input-text, #f8fafc)',
                  }}
                />
                <button
                  onClick={addInviteEmail}
                  disabled={!inviteInput.trim()}
                  className="px-4 h-10 rounded-lg text-sm font-medium shrink-0 transition-colors"
                  style={{
                    background: 'var(--accent-primary-bg, rgba(250,77,46,0.15))',
                    color: 'var(--accent-primary, #fa4d2e)',
                    border: '1px solid var(--accent-primary, #fa4d2e)',
                    opacity: inviteInput.trim() ? 1 : 0.4,
                  }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Queued invites */}
            {inviteEmails.length > 0 && (
              <div className="space-y-1.5">
                {inviteEmails.map(email => {
                  const cross = isEmailCrossDomain(email)
                  return (
                    <div
                      key={email}
                      className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{
                        background: 'var(--surface-secondary, #0f1524)',
                        border: '1px solid var(--border, #121a2b)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm truncate" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                          {email}
                        </span>
                        {cross && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                            style={{
                              background: 'rgba(250, 204, 21, 0.15)',
                              color: '#facc15',
                              border: '1px solid rgba(250, 204, 21, 0.3)',
                            }}
                          >
                            External
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeInviteEmail(email)}
                        className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0 ml-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {emailDomain && (
              <p className="text-xs" style={{ color: 'var(--text-muted, #475569)' }}>
                Anyone with an <span style={{ color: 'var(--text-secondary, #94a3b8)' }}>@{emailDomain}</span> email can be invited for free.
                {inviteEmails.some(isEmailCrossDomain) && (
                  <span style={{ color: '#facc15' }}> External users will require a paid plan.</span>
                )}
              </p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="btn-secondary flex-1 justify-center">Back</button>
              <button onClick={() => setStep(3)} className="btn-primary flex-1 justify-center">
                {inviteEmails.length > 0 ? `Continue with ${inviteEmails.length} invite${inviteEmails.length !== 1 ? 's' : ''}` : 'Skip for now'}
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 3 — Get started ═══ */}
        {step === 3 && !showBooking && (
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
              <button
                onClick={completeOnboarding}
                disabled={saving}
                className="w-full text-left rounded-xl p-5 transition-all"
                style={{ background: 'var(--surface-secondary, #0f1524)', border: '1px solid var(--border, #121a2b)' }}
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
                      {saving ? 'Creating workspace…' : 'Build it myself'}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                      Jump straight into your workspace and create your first AI agent. Takes about 5 minutes.
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setShowBooking(true)}
                disabled={saving}
                className="w-full text-left rounded-xl p-5 transition-all"
                style={{ background: 'var(--surface-secondary, #0f1524)', border: '1px solid var(--border, #121a2b)' }}
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

            <button onClick={() => setStep(2)} className="btn-secondary w-full justify-center">Back</button>
          </div>
        )}

        {/* ═══ Step 3b — Booking view ═══ */}
        {step === 3 && showBooking && (
          <div className="space-y-5">
            <div className="text-center">
              <h2 className="text-xl font-bold tracking-tight mb-1" style={{ color: 'var(--text-primary, #f8fafc)' }}>
                Book your onboarding call
              </h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary, #94a3b8)' }}>
                Pick a time that works for you.
              </p>
            </div>

            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border, #121a2b)' }}>
              <iframe
                src="https://crm.voxility.ai/widget/bookings/voxility-conversational-ai-onb"
                className="w-full border-0"
                style={{ height: '500px', background: 'var(--surface, #090d15)' }}
                title="Book onboarding call"
              />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowBooking(false)} className="btn-secondary flex-1 justify-center">Back</button>
              <button onClick={completeOnboarding} disabled={saving} className="btn-primary flex-1 justify-center">
                {saving ? 'Creating workspace…' : "I'm all set"}
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
