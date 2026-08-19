'use client'

import { ContextPanel } from '@/components/sidebar/ContextPanel'
import { useSidebar } from '@/components/sidebar/SidebarProvider'
import { cn } from '@/lib/utils'

/**
 * The group routes' page frame. Phone: one centred column. Desktop (lg+):
 * the column widens to `max-w-2xl` and yields room on the right to the
 * context panel when a chat question opened one. Navigation is the header's
 * in-place text index (docs/BRAND.md v2 §3) — no rail, no drawer.
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
      className={cn('flex flex-1', panel !== null && 'lg:pr-[26rem]')}
      data-panel-open={panel !== null || undefined}
    >
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col lg:max-w-2xl">
        {children}
      </div>
      <ContextPanel groupId={groupId} memberNames={memberNames} />
    </div>
  )
}
