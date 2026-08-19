'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarProvider'

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

/**
 * Yields room on the right to the desktop context panel while one is open
 * (`lg:pr-[26rem]`), so the header's controls never sit under it. Used by
 * the root Header; the group shell and the docks apply the same offset
 * themselves.
 */
export function PanelOffset({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const { panel } = useSidebar()
  return (
    <div className={cn(className, panel !== null && 'lg:pr-[26rem]')}>
      {children}
    </div>
  )
}
