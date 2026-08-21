import { requireGroupMember } from '@/lib/membership'
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
  return (
    <GroupShell>
      {/* Navigation is the header's in-place text index (NavIndex, path-
          driven) — this layout mounts no nav of its own. This wrapper does
          NOT add `env(safe-area-inset-bottom)` — that lives on `body` (root
          layout) so every route is protected once, never twice. */}
      {children}
    </GroupShell>
  )
}
