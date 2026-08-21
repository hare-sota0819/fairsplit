'use client'

import { usePathname } from 'next/navigation'

/**
 * Hides the global header on the signed-out landing: that screen carries
 * its own masthead (the pixel wordmark block + link index, docs/BRAND.md
 * v2 §2d) and a second wordmark above it read as a mistake. Everywhere
 * else — and on `/` once signed in, which redirects anyway — the header
 * renders.
 */
export function HeaderFrame({
  signedIn,
  children,
}: {
  signedIn: boolean
  children: React.ReactNode
}) {
  const pathname = usePathname()
  if (!signedIn && pathname === '/') return null
  return <>{children}</>
}
