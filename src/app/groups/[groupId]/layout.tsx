import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { SidebarData } from './SidebarData'
import { GroupShell } from './GroupShell'

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { user } = await requireGroupMember(groupId)
  // Payer names for the desktop context panel's history rows.
  const members = await prisma.member.findMany({
    where: { groupId },
    select: { id: true, name: true },
  })
  const memberNames = Object.fromEntries(members.map((m) => [m.id, m.name]))
  return (
    <GroupShell groupId={groupId} memberNames={memberNames}>
      {/* Task 6 (app-shell restructure): the bottom Tabs bar and its FAB are
          gone — the sidebar is the only nav now. No group screen has
          anything of its own fixed at the bottom except home's chat dock,
          which handles its own clearance (see page.tsx). This wrapper does
          NOT add `env(safe-area-inset-bottom)` — a review round moved that
          onto `body` (root layout) instead, since the same protection was
          missing on every NON-group route (`/groups`, `/account`, `/guide`)
          that never rendered this wrapper at all; adding it back here on
          top of `body`'s would double-count the device inset on group
          routes specifically, the same bug fixed once already. */}
      <SidebarData
        groupId={groupId}
        userId={user.id}
        userName={user.name?.trim() ?? ''}
        userEmail={user.email ?? ''}
      />
      {children}
    </GroupShell>
  )
}
