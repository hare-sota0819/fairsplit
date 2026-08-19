import { getTranslations } from 'next-intl/server'
import { InviteBlock } from '@/components/InviteBlock'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

/**
 * The dedicated invite screen — reached deliberately from the sidebar menu,
 * so it shows the invite link/code regardless of how many members the group
 * already has. Uses `invite.body` (member-count-neutral), not `empty.*`,
 * which is reserved for the status screen's alone state.
 */
export default async function GroupInvitePage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireGroupMember(groupId)
  const group = await prisma.group.findUniqueOrThrow({
    where: { id: groupId },
    select: { inviteCode: true },
  })
  const [t, tEmpty, tDetail] = await Promise.all([
    getTranslations('invite'),
    getTranslations('empty'),
    getTranslations('groups.detail'),
  ])

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <header>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
      </header>
      <InviteBlock
        inviteCode={group.inviteCode}
        title={tEmpty('inviteTitle')}
        body={t('body')}
        copyLabel={tDetail('copy')}
        copiedLabel={tDetail('copied')}
      />
    </main>
  )
}
