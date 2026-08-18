'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireUser } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export interface JoinFormState {
  error?: string
}

export async function joinGroup(
  _prev: JoinFormState,
  formData: FormData,
): Promise<JoinFormState> {
  const code = formData.get('code')?.toString() ?? ''
  const user = await requireUser(`/join/${code}`)
  const t = await getTranslations('join.errors')
  const displayName = formData.get('displayName')?.toString().trim()

  const group = await prisma.group.findUnique({
    where: { inviteCode: code },
    include: { members: true },
  })
  if (!group || !displayName) {
    return { error: t('unknownInvite') }
  }

  const existing = group.members.find((member) => member.userId === user.id)
  if (existing) {
    // Rejoining restores the same row — the alternative is a second member
    // for one person, with their old balance stranded on the first.
    if (existing.leftAt !== null) {
      await prisma.member.update({
        where: { id: existing.id },
        data: { leftAt: null, name: displayName },
      })
    }
    redirect(`/groups/${group.id}`)
  }

  const email = user.email?.toLowerCase()
  // Claim a pre-created slot for this identity instead of duplicating.
  const slot = email
    ? group.members.find(
        (member) =>
          member.userId === null &&
          member.invitedEmail?.toLowerCase() === email,
      )
    : undefined
  if (slot) {
    await prisma.member.update({
      where: { id: slot.id },
      data: { userId: user.id, name: displayName },
    })
  } else {
    await prisma.member.create({
      data: { groupId: group.id, userId: user.id, name: displayName },
    })
  }
  redirect(`/groups/${group.id}`)
}
