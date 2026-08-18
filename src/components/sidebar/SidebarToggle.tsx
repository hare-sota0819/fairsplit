'use client'

import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarProvider'

/**
 * The hamburger that opens the sidebar. Rendered (reserving its layout
 * space) on every `/groups/<id>` route (and its sub-routes); made INERT
 * rather than absent until a `Sidebar` has actually registered itself for
 * the route.
 *
 * Absent-until-registered was tried first and reverted: `registered` only
 * flips true in a post-hydration effect, so on every hard load/refresh the
 * server-rendered HTML had no button at all, and it popped in afterwards,
 * shifting the app-name link over by its own width. Rendering it always
 * (just inert while unregistered — a route matching `/groups/<id>` that
 * 404s, e.g. an unknown or non-member group, never mounts a `Sidebar`)
 * keeps the layout stable and still leaves no clickable dead button there.
 *
 * A client child of the (server) Header, the same split `AccountMenu` uses:
 * `usePathname` needs the client, but the header around it does not.
 */
export function SidebarToggle({ label }: { label: string }) {
  const pathname = usePathname()
  const { setOpen, registered } = useSidebar()
  // Matches `/groups/<id>` and its sub-routes, but not `/groups` (the list)
  // or `/groups/new` (the create form) — neither mounts a `Sidebar`.
  const groupSegment = pathname.match(/^\/groups\/([^/]+)/)?.[1]
  const inGroup = groupSegment !== undefined && groupSegment !== 'new'
  if (!inGroup) {
    return null
  }
  return (
    <button
      type="button"
      aria-label={label}
      aria-hidden={!registered || undefined}
      tabIndex={registered ? undefined : -1}
      data-testid="sidebar-toggle"
      onClick={() => setOpen(true)}
      className={cn(
        // T7 intake: this was the one control with no press state at all.
        // Same recipe as every other filled/ghost control (PITCH_TEARDOWN.md
        // "Scale press") — a fill delta plus scale(0.97) on touch.
        // Hidden at lg+: the sidebar is a persistent rail there, not a
        // drawer (shell phase B, 2026-08-16).
        'flex size-10 items-center justify-center rounded-full text-foreground transition-[background-color,transform] duration-fast ease-swift hover:bg-muted active:scale-[0.97] active:bg-muted lg:hidden',
        !registered && 'invisible pointer-events-none',
      )}
    >
      <Menu aria-hidden="true" className="size-5" />
    </button>
  )
}
