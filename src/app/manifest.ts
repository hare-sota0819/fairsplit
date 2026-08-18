import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FairSplit',
    short_name: 'FairSplit',
    description: 'Split group expenses fairly — at your own exchange rate.',
    start_url: '/',
    display: 'standalone',
    // Marble-white chrome (docs/BRAND.md §2a), matching --background.
    background_color: '#f7f5f1',
    theme_color: '#f7f5f1',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  }
}
