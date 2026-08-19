import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { GroupShell } from './GroupShell'

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireGroupMember(groupId)
  // Payer names for the desktop context panel's history rows.
  const members = await prisma.member.findMany({
    where: { groupId },
    select: { id: true, name: true },
  })
  const memberNames = Object.fromEntries(members.map((m) => [m.id, m.name]))
  return (
    <GroupShell groupId={groupId} memberNames={memberNames}>
      {/* Navigation is the header's in-place text index (NavIndex, path-
          driven) — this layout mounts no nav of its own. No group screen
          has anything fixed at the bottom except home's chat dock, which
          handles its own clearance (see page.tsx). This wrapper does NOT
          add `env(safe-area-inset-bottom)` — that lives on `body` (root
          layout) so every route is protected once, never twice. */}
      {children}
    </GroupShell>
  )
}
