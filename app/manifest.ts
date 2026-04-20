import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Voxility',
    short_name: 'Voxility',
    description: 'Conversational AI agents across every channel',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#fa4d2e',
    orientation: 'portrait-primary',
    // Only reference icons that actually exist in public/ or app/. The
    // previous list pointed at /icon.png and /icon-512.png which never got
    // added — browsers would 404 on those and surface a console warning.
    icons: [
      {
        src: '/favicon.ico',
        sizes: '256x256',
        type: 'image/x-icon',
      },
      {
        src: '/logo-mark.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
    categories: ['business', 'productivity', 'communication'],
  }
}
