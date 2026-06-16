/**
 * Parse a demo/help video URL into the markup we should render.
 * Reused by the help article renderer and the marketing demo drawer.
 *
 *  - YouTube / Vimeo / Loom  → an iframe embed (autoplay-friendly src)
 *  - .mp4 / .webm / .ogg      → a native <video> file source
 *  - empty / unrecognized     → none (caller shows a "coming soon" poster)
 */
export type ParsedVideo =
  | { kind: 'iframe'; src: string }
  | { kind: 'file'; src: string }
  | { kind: 'none' }

export function parseVideo(url: string | null | undefined, opts?: { autoplay?: boolean }): ParsedVideo {
  if (!url || !url.trim()) return { kind: 'none' }
  const u = url.trim()
  const autoplay = opts?.autoplay ? 1 : 0

  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/)
  if (yt) return { kind: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}?rel=0&autoplay=${autoplay}` }

  const vimeo = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return { kind: 'iframe', src: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=${autoplay}` }

  const loom = u.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/)
  if (loom) return { kind: 'iframe', src: `https://www.loom.com/embed/${loom[1]}?autoplay=${autoplay}` }

  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u)) return { kind: 'file', src: u }

  return { kind: 'none' }
}
