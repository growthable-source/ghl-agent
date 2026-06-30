'use client'

import { useEffect, useState } from 'react'
import { parseVideo } from '@/lib/video-embed'

/**
 * "Watch the demo" trigger + a right-edge panel that slides out and plays
 * the demo video (YouTube/Vimeo/Loom embed or a self-hosted mp4). Pure-CSS
 * slide (see .vox-slide-in-right in globals.css) — no animation lib. Empty
 * videoUrl shows a graceful "coming soon" state so the mechanism ships
 * before the URL is finalized.
 */
export default function DemoVideoDrawer({
  videoUrl,
  triggerClassName = 'btn-secondary',
  triggerLabel = '▶ Watch the 2-min demo',
}: {
  videoUrl?: string
  triggerClassName?: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  const video = parseVideo(videoUrl, { autoplay: true })

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex justify-end vox-backdrop-fade"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setOpen(false)}
        >
          <aside
            className="relative h-full w-full max-w-2xl flex flex-col vox-slide-in-right"
            style={{ background: 'var(--surface)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 48px rgba(0,0,0,0.18)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <p className="section-label">See it in action</p>
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>The 2-minute Xovera demo</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close demo"
                className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-secondary)]"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="relative w-full aspect-video rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', background: '#000' }}>
                {video.kind === 'iframe' && (
                  <iframe
                    src={video.src}
                    title="Xovera demo"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                  />
                )}
                {video.kind === 'file' && (
                  <video src={video.src} controls autoPlay className="absolute inset-0 w-full h-full object-contain bg-black" />
                )}
                {video.kind === 'none' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-6" style={{ background: 'var(--surface-secondary)' }}>
                    <span className="text-3xl">🎬</span>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Demo video coming soon</p>
                    <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      In the meantime, start a free build or try the live Co-Pilot demo.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mt-6">
                <a href="/start" className="btn-primary">Start building free</a>
                <a href="#copilot" onClick={() => setOpen(false)} className="btn-secondary">Try the live Co-Pilot demo</a>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
