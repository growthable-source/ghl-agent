'use client'

/**
 * Client half of the partner-embedded builder.
 *
 * Renders the shared appearance fields plus a live preview, and writes
 * through the same PATCH the dashboard editor uses. Uses the canonical
 * useDirtyForm + SaveBar pattern so "have my changes saved?" reads the
 * same here as everywhere else in the product.
 */

import { useState, useMemo } from 'react'
import SaveBar from '@/components/dashboard/SaveBar'
import { useDirtyForm } from '@/lib/use-dirty-form'
import {
  WidgetAppearanceFields, Section, LauncherBubblePreview, ChatPreview,
  type WidgetAppearance,
} from '@/components/widget/WidgetAppearance'

interface BuilderWidget extends WidgetAppearance, Record<string, unknown> {
  isActive: boolean
  publicKey: string
  workspaceId: string
}

export default function EmbeddedWidgetBuilder({
  initialWidget, workspaceId, trial,
}: {
  initialWidget: Omit<BuilderWidget, 'workspaceId'> & { workspaceId: string }
  workspaceId: string
  trial: { endsAt: string | null; expired: boolean } | null
}) {
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

  const initial = useMemo(() => initialWidget as BuilderWidget, [initialWidget])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<BuilderWidget>({
    initial,
    onSave: async (d) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets/${d.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // The embed session cookie is SameSite=None; same-origin fetches
        // send it anyway, but be explicit — this page only ever runs in
        // a third-party frame.
        credentials: 'include',
        body: JSON.stringify({
          name: d.name,
          primaryColor: d.primaryColor,
          backgroundColor: d.backgroundColor ?? null,
          textColor: d.textColor ?? null,
          logoUrl: d.logoUrl,
          title: d.title,
          subtitle: d.subtitle,
          welcomeMessage: d.welcomeMessage,
          position: d.position,
          launcherIcon: d.launcherIcon,
          launcherLetter: d.launcherLetter,
          isActive: d.isActive,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || 'Could not save your changes.')
      }
    },
  })

  function update<K extends keyof BuilderWidget>(key: K, val: BuilderWidget[K]) {
    set({ [key]: val } as Partial<BuilderWidget>)
  }

  async function uploadLogo(file: File) {
    setLogoError(null)
    setUploadingLogo(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets/upload-logo`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Upload failed')
      update('logoUrl', body.url)
    } catch (err: unknown) {
      setLogoError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploadingLogo(false)
    }
  }

  const trialDaysLeft = trial?.endsAt
    ? Math.max(0, Math.ceil((new Date(trial.endsAt).getTime() - Date.now()) / 86400000))
    : null

  return (
    <div className="min-h-screen bg-zinc-950 p-5 pb-28">
      <div className="max-w-4xl mx-auto space-y-5">

        {trial && (
          <div className={`p-4 rounded-xl border ${
            trial.expired
              ? 'border-accent-red-border bg-accent-red-bg'
              : 'border-zinc-800 bg-zinc-900/40'
          }`}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-zinc-100">
                  {trial.expired
                    ? 'Your trial has ended'
                    : trialDaysLeft === null
                      ? 'You’re on a free trial'
                      : `${trialDaysLeft} ${trialDaysLeft === 1 ? 'day' : 'days'} left on your free trial`}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {trial.expired
                    ? 'Your widget has stopped answering visitors. Choose a plan to switch it back on.'
                    : 'Keep your AI assistant answering questions after the trial ends.'}
                </p>
              </div>
              {/*
                Opens TOP-LEVEL, not in this frame. Stripe Checkout does
                not run reliably inside a nested third-party iframe, and
                the customer needs to see our domain in the address bar
                before they type card details.
              */}
              <a
                href={`/dashboard/${workspaceId}/settings/billing?from=help_center`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity flex-shrink-0"
                style={{ background: '#fa4d2e' }}
              >
                Choose a plan →
              </a>
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <input
              type="text"
              value={draft.name ?? ''}
              onChange={e => update('name', e.target.value)}
              className="text-xl font-bold text-white bg-transparent border-0 p-0 w-full focus:outline-none focus:ring-0"
              aria-label="Widget name"
            />
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Changes go live on your site as soon as you save.
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer flex-shrink-0 pt-1">
            <button
              type="button"
              onClick={() => update('isActive', !draft.isActive)}
              className="relative inline-flex h-5 w-9 items-center rounded-full"
              style={{ background: draft.isActive ? '#22c55e' : '#3f3f46' }}
              aria-pressed={draft.isActive}
            >
              <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
                style={{ transform: draft.isActive ? 'translateX(20px)' : 'translateX(4px)' }} />
            </button>
            <span className="text-xs text-zinc-400">{draft.isActive ? 'Live' : 'Paused'}</span>
          </label>
        </div>

        <div className="grid lg:grid-cols-[1fr_260px] gap-5 items-start">
          <Section title="Appearance">
            <WidgetAppearanceFields
              widget={draft}
              update={update}
              uploadLogo={uploadLogo}
              uploadingLogo={uploadingLogo}
              logoError={logoError}
            />
          </Section>

          <div className="space-y-3 lg:sticky lg:top-5">
            <p className="text-xs font-semibold text-zinc-400">Preview</p>
            <div className="h-[380px] rounded-xl border border-zinc-800 overflow-hidden">
              <ChatPreview widget={draft} />
            </div>
            <div className="flex justify-end pr-1">
              <LauncherBubblePreview widget={draft} />
            </div>
          </div>
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        error={error}
        onSave={save}
        onReset={reset}
      />
    </div>
  )
}
