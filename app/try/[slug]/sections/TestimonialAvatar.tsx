import Image from 'next/image'
import type { BrandTestimonial } from '@/lib/demo-brands'

/**
 * Avatar for a testimonial, shared by the Testimonials section and the
 * checkout OrderSummary so both render a given brand's social proof the
 * same way.
 *
 * `avatar` is optional on purpose. Whitelabel brands (ASC Warranty) carry
 * their own real, published customer testimonials but no portraits of the
 * people who wrote them — and dropping a stock photo next to a real named
 * person would be inventing a face for a real quote. Those fall back to
 * monogram initials on the brand accent instead.
 */
export default function TestimonialAvatar({ testimonial, size = 36 }: { testimonial: BrandTestimonial; size?: number }) {
  if (testimonial.avatar) {
    return (
      <div className="relative rounded-full overflow-hidden shrink-0" style={{ width: size, height: size }}>
        <Image src={testimonial.avatar} alt="" width={size} height={size} className="object-cover w-full h-full" />
      </div>
    )
  }

  const initials = testimonial.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <div
      aria-hidden
      className="rounded-full shrink-0 flex items-center justify-center font-bold"
      style={{
        width: size,
        height: size,
        background: 'var(--accent-primary-bg)',
        color: 'var(--accent-primary)',
        fontSize: Math.round(size * 0.36),
      }}
    >
      {initials}
    </div>
  )
}
