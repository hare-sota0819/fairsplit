'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarProvider'

/** True on `/groups/<id>` and its sub-routes — the routes that mount a
 *  `Sidebar` (and, at lg+, its fixed left rail). `/groups` and
 *  `/groups/new` do not. Same rule `SidebarToggle` applies. */
export function useInGroupRoute(): boolean {
  const pathname = usePathname()
  const segment = pathname.match(/^\/groups\/([^/]+)/)?.[1]
  return segment !== undefined && segment !== 'new'
}

/**
 * Offsets its children by the desktop rail's width on group routes, so the
 * header (root layout) and the group shell line up beside the fixed rail
 * without the root layout having to know about groups. Pathname-driven
 * (available during SSR) rather than `registered`-driven (an effect, which
 * would pop the offset in after hydration).
 */
export function RailOffset({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const inGroup = useInGroupRoute()
  const { panel } = useSidebar()
  return (
    <div
      className={cn(
        className,
        inGroup && 'lg:pl-72',
        inGroup && panel !== null && 'lg:pr-[26rem]',
      )}
    >
      {children}
    </div>
  )
}

/**
 * Wraps the header's wordmark: hidden at lg+ on group routes, where the
 * rail already carries the wordmark at the same height (a second one
 * side by side read as a mistake).
 */
export function BrandSlot({ children }: { children: React.ReactNode }) {
  const inGroup = useInGroupRoute()
  return <div className={cn(inGroup && 'lg:hidden')}>{children}</div>
}
