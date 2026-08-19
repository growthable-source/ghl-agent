'use client'

/**
 * Widget appearance controls, shared by the two surfaces that edit them:
 *
 *   - app/dashboard/[workspaceId]/widgets/[widgetId]   (full editor)
 *   - app/embedded/widget-builder/[widgetId]           (partner iframe)
 *
 * Only appearance lives here. Routing, per-location agency controls,
 * install snippets and deletion stay on the dashboard page — a customer
 * reaching the builder from a partner's admin UI has no business
 * deleting the widget or reassigning it to team members they can't see.
 *
 * Both surfaces write through the same PATCH
 * /api/workspaces/:wid/widgets/:id whitelist, so keeping the FIELDS in
 * one place is what stops the two drifting.
 */

import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
import NewBadge from '@/components/NewBadge'

export interface WidgetAppearance {
  id: string
  name: string
  type: 'chat' | 'click_to_call'
  embedMode: 'floating' | 'inline'
  primaryColor: string
  // Conversation surface + text. null/absent = the default dark theme
  // (near-black surface, auto near-white text). See lib/widget-theme.ts.
  backgroundColor?: string | null
  textColor?: string | null
  logoUrl: string | null
  title: string
  subtitle: string
  welcomeMessage: string
  position: string
  launcherIcon?: 'chat' | 'question' | 'letter' | 'logo'
  launcherLetter?: string | null
}

/** Common conversation-surface choices — dark (default) and light. */
export const CONVERSATION_BG_PRESETS = ['#09090b', '#ffffff', '#f4f4f5', '#1a1a2e', '#0f172a']

// Pure mirror of lib/widget-theme's auto-contrast so the picker can show
// the effective text colour without importing server code paths.
function autoText(bg: string): string {
  const h = bg.replace('#', '')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#f4f4f5'
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
  const chan = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const lum = 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
  return lum > 0.5 ? '#0a0a0a' : '#f4f4f5'
}

/** Gmail-style quick palette for the launcher. Presets only — the colour
 *  input beside it still accepts any hex. */
export const LAUNCHER_PRESET_COLORS = [
  '#fa4d2e', '#d93025', '#e8710a', '#f4b400', '#188038',
  '#12a4af', '#1a73e8', '#7c3aed', '#d01884', '#5f6368',
]

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 space-y-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {children}
    </div>
  )
}

export function Field({ label, children, helper }: { label: string; children: React.ReactNode; helper?: string }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      {children}
      {helper && <p className="text-[10px] text-zinc-500 mt-1">{helper}</p>}
    </div>
  )
}

const LAUNCHER_ICON_OPTIONS = [
  { key: 'chat', label: 'Chat bubble' },
  { key: 'question', label: 'Question mark' },
  { key: 'letter', label: 'Letter mark' },
  { key: 'logo', label: 'Your logo' },
] as const

function ChatGlyph({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

/**
 * Conversation surface + text pickers. Background defaults to the dark
 * theme; text defaults to "Auto" (auto-contrast against the background,
 * so black/white just work) with an explicit override when you want it.
 */
function ConversationColorFields<W extends WidgetAppearance>({
  widget, update,
}: { widget: W; update: <K extends keyof W>(key: K, val: W[K]) => void }) {
  const bg = (widget.backgroundColor as string | null | undefined) || '#09090b'
  const textOverride = (widget.textColor as string | null | undefined) || null
  const effectiveText = textOverride ?? autoText(bg)

  return (
    <Field label="Conversation colours" helper="The chat background and text. Text auto-picks black or white for contrast unless you override it.">
      {/* Background */}
      <div className="flex gap-2 items-center">
        <input type="color" value={bg} onChange={e => update('backgroundColor' as keyof W, e.target.value as W[keyof W])}
          className="w-10 h-10 bg-transparent border border-zinc-700 rounded cursor-pointer" />
        <input type="text" value={bg} onChange={e => update('backgroundColor' as keyof W, e.target.value as W[keyof W])}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono" />
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2">
        {CONVERSATION_BG_PRESETS.map(c => (
          <button key={c} type="button" title={c}
            onClick={() => update('backgroundColor' as keyof W, c as W[keyof W])}
            className={`w-6 h-6 rounded-full border border-zinc-700 transition-transform hover:scale-110 ${
              bg.toLowerCase() === c ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900' : ''
            }`}
            style={{ background: c }}
            aria-label={`Use ${c}`} />
        ))}
      </div>

      {/* Text colour — Auto vs override */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={textOverride === null}
            onChange={e => update('textColor' as keyof W, (e.target.checked ? null : effectiveText) as W[keyof W])}
            className="accent-orange-500" />
          Auto text ({effectiveText.toLowerCase()})
        </label>
        {textOverride !== null && (
          <span className="flex gap-2 items-center">
            <input type="color" value={textOverride} onChange={e => update('textColor' as keyof W, e.target.value as W[keyof W])}
              className="w-8 h-8 bg-transparent border border-zinc-700 rounded cursor-pointer" />
            <input type="text" value={textOverride} onChange={e => update('textColor' as keyof W, e.target.value as W[keyof W])}
              className="w-24 bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white font-mono" />
          </span>
        )}
      </div>

      {/* Live swatch */}
      <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{ background: bg, color: effectiveText, border: '1px solid #3f3f46' }}>
        Sample conversation text
      </div>
    </Field>
  )
}

export interface WidgetAppearanceFieldsProps<W extends WidgetAppearance> {
  widget: W
  update: <K extends keyof W>(key: K, val: W[K]) => void
  uploadLogo: (file: File) => void
  uploadingLogo: boolean
  logoError: string | null
}

export function WidgetAppearanceFields<W extends WidgetAppearance>({
  widget, update, uploadLogo, uploadingLogo, logoError,
}: WidgetAppearanceFieldsProps<W>) {
  const isCallType = widget.type === 'click_to_call'
  const isInline = widget.embedMode === 'inline'
  const icon = widget.launcherIcon || 'chat'

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Primary color">
          <div className="flex gap-2">
            <input type="color" value={widget.primaryColor} onChange={e => update('primaryColor' as keyof W, e.target.value as W[keyof W])}
              className="w-10 h-10 bg-transparent border border-zinc-700 rounded cursor-pointer" />
            <input type="text" value={widget.primaryColor} onChange={e => update('primaryColor' as keyof W, e.target.value as W[keyof W])}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono" />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {LAUNCHER_PRESET_COLORS.map(c => (
              <button key={c} type="button" title={c}
                onClick={() => update('primaryColor' as keyof W, c as W[keyof W])}
                className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${
                  widget.primaryColor.toLowerCase() === c ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900' : ''
                }`}
                style={{ background: c }}
                aria-label={`Use ${c}`} />
            ))}
          </div>
        </Field>
        {!isCallType && (
          <ConversationColorFields widget={widget} update={update} />
        )}
        {(!isCallType || !isInline) && (
          <Field label="Position">
            <select value={widget.position} onChange={e => update('position' as keyof W, e.target.value as W[keyof W])}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white">
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </Field>
        )}
      </div>

      {!isCallType && (
        <>
          <Field label="Title">
            <input type="text" value={widget.title} onChange={e => update('title' as keyof W, e.target.value as W[keyof W])}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
          </Field>
          <Field label="Subtitle">
            <input type="text" value={widget.subtitle} onChange={e => update('subtitle' as keyof W, e.target.value as W[keyof W])}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
          </Field>
          <Field label="Welcome message">
            <MergeFieldTextarea value={widget.welcomeMessage}
              onChange={e => update('welcomeMessage' as keyof W, e.target.value as W[keyof W])}
              onValueChange={v => update('welcomeMessage' as keyof W, v as W[keyof W])}
              placeholder="Hi {{contact.first_name|there}}, how can we help?"
              rows={2}
              className="w-full bg-zinc-950 border border-zinc-700 rounded pl-3 pr-3 pt-8 pb-2 text-sm text-white" />
          </Field>
        </>
      )}

      {!isCallType && (
        <div>
          <label className="text-xs text-zinc-400 mb-1 flex items-center gap-1.5">
            Launcher icon <NewBadge since="2026-07-16" />
          </label>
          <p className="text-[10px] text-zinc-500 mb-2">What the floating chat bubble shows on your site.</p>
          <div className="flex items-center gap-2.5 flex-wrap">
            {LAUNCHER_ICON_OPTIONS.map(opt => {
              const selected = icon === opt.key
              return (
                <button key={opt.key} type="button" title={opt.label}
                  onClick={() => update('launcherIcon' as keyof W, opt.key as W[keyof W])}
                  className={`w-11 h-11 rounded-full flex items-center justify-center text-white overflow-hidden transition-transform hover:scale-105 ${
                    selected ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ background: widget.primaryColor }}
                  aria-label={opt.label} aria-pressed={selected}
                >
                  {opt.key === 'chat' && <ChatGlyph />}
                  {opt.key === 'question' && <span className="text-xl font-bold leading-none">?</span>}
                  {opt.key === 'letter' && (
                    <span className="text-lg font-bold leading-none">
                      {(widget.launcherLetter || widget.title.charAt(0) || 'A').toUpperCase()}
                    </span>
                  )}
                  {opt.key === 'logo' && (
                    widget.logoUrl
                      ? <img src={widget.logoUrl} alt="" className="w-full h-full object-cover" />
                      : <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
                  )}
                </button>
              )
            })}
            {icon === 'letter' && (
              <select
                value={widget.launcherLetter || ''}
                onChange={e => update('launcherLetter' as keyof W, (e.target.value || null) as W[keyof W])}
                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-2 text-sm text-white"
                aria-label="Letter"
              >
                <option value="">Auto ({(widget.title.charAt(0) || 'A').toUpperCase()})</option>
                {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            )}
          </div>
          {icon === 'logo' && !widget.logoUrl && (
            <p className="text-[10px] text-accent-amber mt-1.5">Upload or paste a logo below — until then the bubble shows the chat icon.</p>
          )}
        </div>
      )}

      <Field label={isCallType ? 'Logo (optional)' : 'Logo (optional — shown in the chat header, and on the bubble if selected above)'}>
        <div className="flex items-center gap-2">
          {widget.logoUrl && (
            <img src={widget.logoUrl} alt="Logo" className="w-10 h-10 rounded-full object-cover border border-zinc-700 flex-shrink-0" />
          )}
          <label className={`text-xs font-semibold px-3 py-2 rounded border border-zinc-700 text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer flex-shrink-0 ${uploadingLogo ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploadingLogo ? 'Uploading…' : widget.logoUrl ? 'Replace' : 'Upload image'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) uploadLogo(f)
                e.target.value = ''
              }} />
          </label>
          {widget.logoUrl && (
            <button type="button" onClick={() => update('logoUrl' as keyof W, null as W[keyof W])}
              className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex-shrink-0">
              Remove
            </button>
          )}
          <input type="url" value={widget.logoUrl || ''} onChange={e => update('logoUrl' as keyof W, (e.target.value || null) as W[keyof W])}
            placeholder="or paste a URL — https://…"
            className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white" />
        </div>
        {logoError && <p className="text-[10px] text-red-400 mt-1">{logoError}</p>}
      </Field>
    </>
  )
}

/** The launcher bubble exactly as widget.js renders it closed — same 56px
 *  circle, same icon fallback rules (a logo pick without a logo degrades
 *  to the chat glyph). */
export function LauncherBubblePreview({ widget }: { widget: WidgetAppearance }) {
  const icon = widget.launcherIcon || 'chat'
  return (
    <div className="w-14 h-14 rounded-full flex items-center justify-center text-white overflow-hidden shadow-lg flex-shrink-0"
      style={{ background: widget.primaryColor }}>
      {icon === 'logo' && widget.logoUrl ? (
        <img src={widget.logoUrl} alt="" className="w-full h-full object-cover" />
      ) : icon === 'question' ? (
        <span className="text-2xl font-bold leading-none">?</span>
      ) : icon === 'letter' ? (
        <span className="text-xl font-bold leading-none">{(widget.launcherLetter || widget.title.charAt(0) || 'A').toUpperCase()}</span>
      ) : (
        <ChatGlyph size={24} />
      )}
    </div>
  )
}

export function ChatPreview({ widget }: { widget: WidgetAppearance }) {
  // Mirror the embed's theme so the preview matches what ships. Kept in
  // sync with lib/widget-theme.ts (surface = bg nudged toward its
  // opposite, muted/border mixed between bg and fg).
  const bg = widget.backgroundColor || '#09090b'
  const fg = widget.textColor || autoText(bg)
  const isLight = autoText(bg) === '#0a0a0a'
  const surface = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)'
  const border = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)'
  const muted = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)'
  return (
    <div className="h-full flex flex-col text-xs" style={{ background: bg, color: fg }}>
      <div className="px-3 py-2.5 flex items-center gap-2 border-b" style={{ background: `linear-gradient(135deg, ${widget.primaryColor}25, ${widget.primaryColor}10)`, borderColor: border }}>
        {widget.logoUrl ? (
          <img src={widget.logoUrl} alt="" className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: widget.primaryColor, color: '#fff' }}>
            {widget.title.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{widget.title}</p>
          <p className="text-[10px] truncate" style={{ color: muted }}>{widget.subtitle}</p>
        </div>
      </div>
      <div className="flex-1 p-3 space-y-2 overflow-y-auto">
        <div className="flex justify-start">
          <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tl-sm text-xs" style={{ background: surface, color: fg }}>
            {widget.welcomeMessage}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-tr-sm text-white text-xs"
            style={{ background: widget.primaryColor }}>
            Hi! What times are you available for a demo?
          </div>
        </div>
      </div>
      <div className="p-2 border-t" style={{ borderColor: border }}>
        <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ background: surface, border: `1px solid ${border}` }}>
          <span className="text-[10px] flex-1" style={{ color: muted }}>Type a message…</span>
          <div className="w-6 h-6 rounded-full" style={{ background: widget.primaryColor }} />
        </div>
      </div>
    </div>
  )
}
