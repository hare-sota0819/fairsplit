'use client'

import dynamic from 'next/dynamic'

/**
 * Client-only entry for Sem's body (docs/BRAND.md v2 §4a: three.js in a
 * client component, `ssr: false`). Server render leaves a same-sized
 * empty box so nothing shifts when the creature arrives.
 */
export const SemBodyLazy = dynamic(
  () => import('./SemBody').then((m) => m.SemBody),
  {
    ssr: false,
    loading: () => null,
  },
)
