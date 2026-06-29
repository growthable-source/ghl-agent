import type { GymSystem } from '@/lib/integrations-data'

/**
 * Infinite left-scrolling "works with" logo strip. Pure CSS (see the
 * .marquee-* rules in globals.css) — no client JS. The track holds two
 * identical copies of the row so a -50% translate loops seamlessly.
 *
 * Each item renders an official logo when `src` is set, otherwise a clean
 * grayscale wordmark — so dropping real logo files into /public later is a
 * data-only change.
 */
export default function LogoMarquee({ items }: { items: GymSystem[] }) {
  const row = [...items, ...items]
  return (
    <div className="marquee-mask overflow-hidden py-2">
      <ul className="marquee-track items-center gap-12 m-0 p-0 list-none">
        {row.map((it, i) => (
          <li key={`${it.name}-${i}`} className="shrink-0 flex items-center" aria-hidden={i >= items.length}>
            {it.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.src} alt={it.name} className="h-7 w-auto object-contain opacity-60 grayscale" />
            ) : (
              <span
                className="text-xl md:text-2xl font-bold tracking-tight whitespace-nowrap transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
