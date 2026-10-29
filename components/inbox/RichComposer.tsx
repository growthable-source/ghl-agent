'use client'

/**
 * Rich-text reply box for the inbox.
 *
 * Operators asked for more than a plain textarea — paragraphs, bold,
 * lists, links, emoji — so replies can carry some personality. The box
 * is a contentEditable surface driven by document.execCommand (still
 * the only cross-browser way to get native undo/redo + Cmd-B/I without
 * pulling in a full editor framework), and it serializes to MARKDOWN
 * via lib/rich-text-markdown.ts. That matters: the widget and the inbox
 * transcript already render operator replies through ChatMarkdown, so
 * the visitor sees exactly the formatting the operator saw, and no HTML
 * ever leaves the dashboard. The toolbar deliberately only offers what
 * ChatMarkdown can display.
 *
 * Keys:
 *   Enter            send (inside a list: new bullet; empty bullet exits)
 *   Shift+Enter      new line — twice for a paragraph break
 *   Cmd/Ctrl+Enter   always send
 *   Cmd/Ctrl+B/I/K   bold / italic / link
 *   "- " "* " "1. "  at the start of a line → list
 * Typed markdown (**bold**, `code`) also passes straight through.
 *
 * Paste is forced to plain text so styles from Docs/web pages don't
 * leak into the box; pasted/dropped files go to onFiles (screenshots),
 * which the parent stages on the draft and renders via `attachments`.
 *
 * Note on embedding: link entry is an inline popover, not
 * window.prompt — the dashboard runs inside the GHL marketplace iframe,
 * where modals can be sandboxed off.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { richNodeToMarkdown } from '@/lib/rich-text-markdown'

export interface RichComposerHandle {
  clear: () => void
  focus: () => void
}

interface Props {
  placeholder: string
  /** Fires on every edit with the serialized markdown. */
  onChange: (markdown: string) => void
  onSubmit: () => void
  /** Pasted/dropped files. Omit to disable file paste (e.g. note mode). */
  onFiles?: (files: File[]) => void
  onAttachClick?: () => void
  attachDisabled?: boolean
  /** Staged-attachment previews, shown inside the box above the toolbar. */
  attachments?: React.ReactNode
  /** Right-hand slot in the toolbar — the Send button. */
  actions?: React.ReactNode
  /** Tint the box (note mode). */
  tone?: 'default' | 'note'
}

const EMOJI_GROUPS: Array<{ label: string; icon: string; emojis: string[] }> = [
  {
    label: 'Frequent', icon: '⭐',
    emojis: ['👍', '🙏', '😀', '😊', '😅', '🎉', '💯', '🔥', '✅', '❌', '👀', '❤️', '🤔', '👋', '✨', '🙌'],
  },
  {
    label: 'Smileys', icon: '😀',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😂', '🤣', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋',
      '😎', '🤓', '🧐', '🤗', '🤭', '😏', '😌', '😴', '🥳', '😮', '😯', '😲', '🥺', '😢', '😭', '😤',
      '😬', '🙄', '😐', '😑', '😶', '🫡', '🤝', '🤞'],
  },
  {
    label: 'Gestures', icon: '👋',
    emojis: ['👋', '🤚', '✋', '🖐️', '👌', '🤌', '✌️', '🤟', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
      '✊', '👊', '👏', '🙌', '🫶', '👐', '🙏', '💪', '🫵', '🤲'],
  },
  {
    label: 'Objects', icon: '📅',
    emojis: ['📅', '📆', '⏰', '⌛', '📞', '📱', '💻', '📧', '📨', '📎', '📝', '📌', '📍', '🔗', '🔒', '🔑',
      '💡', '📈', '📊', '💰', '💳', '🧾', '🎁', '🚀', '🏆', '🎯', '🛠️', '⚙️', '📦', '🚚'],
  },
  {
    label: 'Symbols', icon: '❤️',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '✅', '☑️', '✔️', '❌', '⚠️', '❗', '❓',
      '💯', '🔥', '✨', '⭐', '🌟', '⚡', '🎉', '🎊', '👉', '➡️', '⬆️', '⬇️', '🔔', '🆕'],
  },
]

type Format = 'bold' | 'italic' | 'code' | 'ul' | 'ol' | 'link'

function closestIn(node: Node | null, root: HTMLElement, tags: string[]): HTMLElement | null {
  let n: Node | null = node
  while (n && n !== root) {
    if (n.nodeType === 1 && tags.includes((n as HTMLElement).tagName)) return n as HTMLElement
    n = n.parentNode
  }
  return null
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function ToolButton({ title, active, onPress, children }: {
  title: string
  active: boolean
  onPress: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      // mousedown, not click: keeps the editor's selection alive.
      onMouseDown={e => { e.preventDefault(); onPress() }}
      className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-[var(--surface-secondary)]"
      style={active
        ? { color: 'var(--text-primary)', background: 'var(--surface-tertiary)' }
        : { color: 'var(--text-tertiary)' }}
    >{children}</button>
  )
}

const RichComposer = forwardRef<RichComposerHandle, Props>(function RichComposer(
  { placeholder, onChange, onSubmit, onFiles, onAttachClick, attachDisabled, attachments, actions, tone = 'default' },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const savedRange = useRef<Range | null>(null)
  const [empty, setEmpty] = useState(true)
  const [active, setActive] = useState<Record<Format, boolean>>({ bold: false, italic: false, code: false, ul: false, ol: false, link: false })
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [emojiGroup, setEmojiGroup] = useState(0)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  const emit = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    const md = richNodeToMarkdown(el)
    setEmpty(md.trim() === '')
    onChange(md)
  }, [onChange])

  useImperativeHandle(ref, () => ({
    clear() {
      if (editorRef.current) editorRef.current.innerHTML = ''
      savedRange.current = null
      setEmpty(true)
      onChange('')
    },
    focus() { editorRef.current?.focus() },
  }), [onChange])

  // Track the caret so toolbar/emoji/link actions (which steal focus)
  // can restore it, and so toolbar buttons show the active state.
  useEffect(() => {
    const onSel = () => {
      const el = editorRef.current
      const sel = document.getSelection()
      if (!el || !sel || sel.rangeCount === 0) return
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return
      savedRange.current = range.cloneRange()
      const anchor = sel.anchorNode
      setActive({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        code: !!closestIn(anchor, el, ['CODE']),
        ul: !!closestIn(anchor, el, ['UL']),
        ol: !!closestIn(anchor, el, ['OL']),
        link: !!closestIn(anchor, el, ['A']),
      })
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  /** Snapshot the live selection now — selectionchange fires async, so
   *  the tracked range can lag a fast shift-arrow + shortcut. */
  function captureSelection() {
    const el = editorRef.current
    const sel = document.getSelection()
    if (!el || !sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange()
  }

  function restoreSelection() {
    const el = editorRef.current
    if (!el) return
    const sel = document.getSelection()
    if (!sel) return
    // Toolbar buttons act on mousedown with preventDefault, so the live
    // selection is usually still in the editor — trust it over the snapshot.
    if (document.activeElement === el && sel.rangeCount > 0 && el.contains(sel.getRangeAt(0).commonAncestorContainer)) return
    el.focus()
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    } else {
      // No caret yet — put it at the end.
      const r = document.createRange()
      r.selectNodeContents(el)
      r.collapse(false)
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }

  function exec(cmd: string, value?: string) {
    restoreSelection()
    document.execCommand(cmd, false, value)
    emit()
  }

  function toggleCode() {
    const el = editorRef.current
    if (!el) return
    restoreSelection()
    const sel = document.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const existing = closestIn(sel.anchorNode, el, ['CODE'])
    if (existing) {
      // Unwrap: replace the <code> with its text.
      existing.replaceWith(document.createTextNode(existing.textContent ?? ''))
    } else {
      const text = sel.toString()
      if (!text) return
      document.execCommand('insertHTML', false, `<code>${escapeHtml(text)}</code>&#8203;`)
    }
    emit()
  }

  function openLink() {
    captureSelection()
    const el = editorRef.current
    const sel = document.getSelection()
    const existing = el && sel ? closestIn(sel.anchorNode, el, ['A']) : null
    setLinkUrl(existing?.getAttribute('href') ?? '')
    setEmojiOpen(false)
    setLinkOpen(true)
  }

  function applyLink() {
    let url = linkUrl.trim()
    setLinkOpen(false)
    const el = editorRef.current
    restoreSelection()
    const sel = document.getSelection()
    if (!el || !sel) return
    const existing = closestIn(sel.anchorNode, el, ['A'])
    if (!url) {
      if (existing) {
        const r = document.createRange(); r.selectNodeContents(existing)
        sel.removeAllRanges(); sel.addRange(r)
        document.execCommand('unlink')
        emit()
      }
      return
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    // ChatMarkdown only links http(s) URLs without spaces/parens.
    if (!/^https?:\/\/[^\s()]+$/i.test(url)) return
    if (sel.isCollapsed && !existing) {
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`)
    } else {
      if (existing && sel.isCollapsed) {
        const r = document.createRange(); r.selectNodeContents(existing)
        sel.removeAllRanges(); sel.addRange(r)
      }
      document.execCommand('createLink', false, url)
    }
    emit()
  }

  function insertEmoji(e: string) {
    restoreSelection()
    document.execCommand('insertText', false, e)
    emit()
  }

  /** "- ", "* ", "1. " typed at the start of a line → list. */
  function maybeAutoList(): boolean {
    const el = editorRef.current
    const sel = document.getSelection()
    if (!el || !sel || !sel.isCollapsed || sel.rangeCount === 0) return false
    const node = sel.anchorNode
    if (!node || node.nodeType !== 3 || closestIn(node, el, ['LI', 'CODE'])) return false
    const before = (node.textContent ?? '').slice(0, sel.anchorOffset)
    // Must be the whole line so far: the text node starts the line.
    const prev = node.previousSibling
    if (prev && !(prev.nodeType === 1 && (prev as HTMLElement).tagName === 'BR')) return false
    let cmd: string | null = null
    if (before === '-' || before === '*') cmd = 'insertUnorderedList'
    else if (before === '1.') cmd = 'insertOrderedList'
    if (!cmd) return false
    const r = document.createRange()
    r.setStart(node, 0); r.setEnd(node, sel.anchorOffset)
    sel.removeAllRanges(); sel.addRange(r)
    document.execCommand('delete')
    document.execCommand(cmd)
    emit()
    return true
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Enter') {
      if (mod) { e.preventDefault(); onSubmit(); return }
      if (e.shiftKey) return
      const el = editorRef.current
      const inList = el ? !!closestIn(document.getSelection()?.anchorNode ?? null, el, ['LI']) : false
      if (inList) return // native: new bullet, or exit on an empty one
      e.preventDefault()
      onSubmit()
      return
    }
    if (e.key === ' ' && maybeAutoList()) { e.preventDefault(); return }
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openLink() }
  }

  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData.files)
    if (files.length > 0) {
      e.preventDefault()
      const images = files.filter(f => f.type.startsWith('image/'))
      if (onFiles && images.length > 0) onFiles(images)
      return
    }
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    if (text) document.execCommand('insertText', false, text)
    emit()
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      e.preventDefault()
      if (onFiles) onFiles(files)
      return
    }
    // Text drags: keep it plain so no foreign markup lands in the box.
    const text = e.dataTransfer.getData('text/plain')
    if (text) {
      e.preventDefault()
      const pos = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(e.clientX, e.clientY)
      if (pos) { const s = document.getSelection(); s?.removeAllRanges(); s?.addRange(pos) }
      document.execCommand('insertText', false, text)
      emit()
    }
  }

  const iconCls = 'w-3.5 h-3.5'
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const modKey = isMac ? '⌘' : 'Ctrl+'

  return (
    <div
      className="flex-1 min-w-0 rounded-lg relative"
      style={{
        background: tone === 'note' ? 'var(--accent-amber-bg)' : 'var(--input-bg)',
        border: `1px solid ${tone === 'note' ? 'var(--accent-amber)' : 'var(--input-border)'}`,
      }}
    >
      <div className="relative">
        {empty && (
          <div
            className="absolute inset-0 px-3 py-2 text-sm pointer-events-none select-none truncate"
            style={{ color: 'var(--text-tertiary)' }}
          >{placeholder}</div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder}
          onInput={emit}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          className={[
            'px-3 py-2 text-sm focus:outline-none min-h-[44px] max-h-48 overflow-y-auto break-words leading-relaxed',
            '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
            '[&_a]:underline [&_a]:underline-offset-2 [&_b]:font-semibold [&_strong]:font-semibold',
            '[&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:bg-black/10',
          ].join(' ')}
          style={{ color: 'var(--input-text)' }}
        />
      </div>

      {attachments}

      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
        <ToolButton title={`Bold (${modKey}B)`} active={active.bold} onPress={() => exec('bold')}>
          <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h8a4 4 0 010 8H6zM6 12h9a4 4 0 010 8H6z" /></svg>
        </ToolButton>
        <ToolButton title={`Italic (${modKey}I)`} active={active.italic} onPress={() => exec('italic')}>
          <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 4h-9M14 20H5M15 4L9 20" /></svg>
        </ToolButton>
        <ToolButton title='Inline code (select text)' active={active.code} onPress={toggleCode}>
          <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /></svg>
        </ToolButton>
        <ToolButton title={`Link (${modKey}K)`} active={active.link} onPress={openLink}>
          <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
        </ToolButton>
        <span className="w-px h-4 mx-1" style={{ background: 'var(--border-secondary)' }} />
        <ToolButton title='Bulleted list' active={active.ul} onPress={() => exec('insertUnorderedList')}>
          <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>
        </ToolButton>
        <ToolButton title='Numbered list' active={active.ol} onPress={() => exec('insertOrderedList')}>
          <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M10 6h11M10 12h11M10 18h11" /><path d="M4 4v4M3 14h2l-2 3h2" strokeWidth={1.6} /></svg>
        </ToolButton>
        <span className="w-px h-4 mx-1" style={{ background: 'var(--border-secondary)' }} />
        <div className="relative">
          <button
            type="button"
            title="Emoji"
            aria-label="Emoji"
            onMouseDown={e => { e.preventDefault(); setLinkOpen(false); setEmojiOpen(o => !o) }}
            className="w-7 h-7 rounded flex items-center justify-center transition-colors hover:bg-[var(--surface-secondary)]"
            style={{ color: emojiOpen ? 'var(--text-primary)' : 'var(--text-tertiary)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          {emojiOpen && (
            <>
              <div className="fixed inset-0 z-30" onMouseDown={() => setEmojiOpen(false)} />
              <div
                className="absolute bottom-9 left-0 z-40 rounded-lg shadow-xl w-[296px]"
                style={{ background: 'var(--surface)', border: '1px solid var(--border-secondary)' }}
              >
                <div className="flex items-center gap-0.5 px-1.5 pt-1.5 border-b" style={{ borderColor: 'var(--border-secondary)' }}>
                  {EMOJI_GROUPS.map((g, i) => (
                    <button
                      key={g.label}
                      type="button"
                      title={g.label}
                      onMouseDown={e => { e.preventDefault(); setEmojiGroup(i) }}
                      className="w-8 h-8 text-base rounded-t transition-colors"
                      style={i === emojiGroup ? { background: 'var(--surface-secondary)' } : { opacity: 0.6 }}
                    >{g.icon}</button>
                  ))}
                </div>
                <div className="p-1.5 grid grid-cols-8 gap-0.5 max-h-44 overflow-y-auto">
                  {EMOJI_GROUPS[emojiGroup].emojis.map((em, i) => (
                    <button
                      key={`${em}-${i}`}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); insertEmoji(em); setEmojiOpen(false) }}
                      className="text-lg w-8 h-8 rounded transition-colors hover:bg-[var(--surface-secondary)]"
                    >{em}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {onAttachClick && (
          <button
            type="button"
            onClick={onAttachClick}
            disabled={attachDisabled}
            title="Attach a file"
            aria-label="Attach a file"
            className="w-7 h-7 rounded flex items-center justify-center transition-colors disabled:opacity-30 hover:bg-[var(--surface-secondary)]"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
            </svg>
          </button>
        )}
        <span className="ml-auto mr-2 text-[10px] hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>
          Shift+Enter for new line
        </span>
        {actions}
      </div>

      {linkOpen && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={() => setLinkOpen(false)} />
          <form
            className="absolute bottom-11 left-2 z-40 flex items-center gap-1.5 rounded-lg p-1.5 shadow-xl"
            style={{ background: 'var(--surface)', border: '1px solid var(--border-secondary)' }}
            onSubmit={e => { e.preventDefault(); applyLink() }}
          >
            <input
              autoFocus
              value={linkUrl}
              onChange={e => setLinkUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false); restoreSelection() } }}
              placeholder="https://…"
              className="w-56 rounded px-2 py-1 text-xs focus:outline-none"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            />
            <button type="submit" className="text-xs font-semibold px-2 py-1 rounded" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>
              {linkUrl.trim() ? 'Apply' : 'Remove'}
            </button>
          </form>
        </>
      )}
    </div>
  )
})

export default RichComposer
