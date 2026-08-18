import { notFound, redirect } from 'next/navigation'
import type { Member } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'

export interface SessionUser {
  id: string
  name?: string | null
  email?: string | null
}

/** Session gate: anonymous visitors are sent to sign-in and come back. */
export async function requireUser(callbackUrl?: string): Promise<SessionUser> {
  const session = await auth()
  if (!session?.user?.id) {
    const suffix = callbackUrl
      ? `?callbackUrl=${encodeURIComponent(callbackUrl)}`
      : ''
    redirect(`/signin${suffix}`)
  }
  return session.user
}

/**
 * Membership gate — the settlement engine trusts its inputs, so EVERY
 * group-scoped page and mutation (Phase 2B included) must resolve the acting
 * member through this. Non-members get a 404 (no group-existence oracle).
 *
 * A member who left keeps their row — their balance still matters to the
 * people they owe — but stops matching here, so they lose every screen.
 */
export async function requireGroupMember(
  groupId: string,
): Promise<{ user: SessionUser; member: Member }> {
  const user = await requireUser(`/groups/${groupId}`)
  const member = await prisma.member.findFirst({
    where: { groupId, userId: user.id, leftAt: null },
  })
  if (!member) {
    notFound()
  }
  return { user, member }
}
