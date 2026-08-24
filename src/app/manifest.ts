import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    // The wordmark is ALWAYS the Latin "Sem", in every locale (owner,
    // 2026-08-24) — never the Korean 셈, which is prose only.
    name: 'Sem',
    short_name: 'Sem',
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
