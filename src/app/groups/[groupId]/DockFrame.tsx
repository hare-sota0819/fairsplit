'use client'

import { useSidebar } from '@/components/sidebar/SidebarProvider'
import { cn } from '@/lib/utils'

/** The chat composer dock's fixed frame: full-width on phones; at lg+ it
 *  starts after the sidebar rail and stops before the context panel while
 *  one is open, so it always spans exactly the chat column. */
export function DockFrame({ children }: { children: React.ReactNode }) {
  const { panel } = useSidebar()
  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:left-72',
        panel !== null && 'lg:right-[26rem]',
      )}
      data-testid="chat-composer-dock"
    >
      {children}
    </div>
  )
}
