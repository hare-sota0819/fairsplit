'use client'

import { ContextPanel } from '@/components/sidebar/ContextPanel'
import { useSidebar } from '@/components/sidebar/SidebarProvider'
import { cn } from '@/lib/utils'

/**
 * The group routes' page frame — shell phase B (2026-08-16). Phone: one
 * centred column, unchanged. Desktop (lg+): the column sits to the right of
 * the fixed sidebar rail (`lg:pl-72`, same offset the header applies via
 * `RailOffset`), widens to `max-w-2xl`, and yields room on the right to the
 * context panel when a chat question opened one — the reference app's
 * sidebar / chat / artifact three-pane arrangement.
 */
export function GroupShell({
  groupId,
  memberNames,
  children,
}: {
  groupId: string
  memberNames: Record<string, string>
  children: React.ReactNode
}) {
  const { panel } = useSidebar()
  return (
    <div
      className={cn('flex flex-1 lg:pl-72', panel !== null && 'lg:pr-[26rem]')}
      data-panel-open={panel !== null || undefined}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:max-w-2xl">
        {children}
      </div>
      <ContextPanel groupId={groupId} memberNames={memberNames} />
    </div>
  )
}
