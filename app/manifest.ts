import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Voxility — AI Agents for GoHighLevel & HubSpot',
    short_name: 'Voxility',
    description:
      'Self-improving conversational AI agents for GoHighLevel and HubSpot. Answer calls, respond to texts, qualify leads, and book appointments — with an agent that gets better every day.',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#05080f',
    theme_color: '#fa4d2e',
    orientation: 'portrait-primary',
    // Icon sources match files that actually exist. /icon.svg is served
    // automatically by Next from app/icon.svg; /favicon.ico is the
    // long-standing fallback for browsers that don't understand SVG
    // favicons yet. /apple-icon.png is auto-served from app/.
    icons: [
      {
        src: '/favicon.ico',
        sizes: '256x256',
        type: 'image/x-icon',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/apple-icon.png',
        sizes: '1024x1024',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    categories: ['business', 'productivity', 'communication'],
  }
}
