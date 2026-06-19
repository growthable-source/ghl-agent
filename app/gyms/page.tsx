import { permanentRedirect } from 'next/navigation'

/**
 * The gym lander moved to the keyword-optimized /ai-for-gyms. Keep the
 * old /gyms URL alive with a permanent (308) redirect so existing links
 * and ads don't break and SEO equity transfers.
 */
export default function GymsRedirect(): never {
  permanentRedirect('/ai-for-gyms')
}
