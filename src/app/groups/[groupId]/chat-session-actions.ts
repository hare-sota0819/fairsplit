'use server'

import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'


/**
 * Session CRUD for the reference-app-style conversation list (R2b, docs/PROMPT.md
 * 2026-08-15). Same privacy law as chat history: every query is scoped to
 * the ACTING member resolved by `requireGroupMember` — a session id from
 * the client is only ever honored when it belongs to that member.
 *
 * Session CREATION lives in `appendChatMessages` (lazy: the first
 * persisted message creates the row), not here — an opened-and-abandoned
 * "new chat" must never clutter the list.
 */

export async function renameChatSession(
  groupId: string,
  sessionId: string,
  title: string,
): Promise<void> {
  const { member } = await requireGroupMember(groupId)
  const trimmed = title.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (trimmed === '') return
  await prisma.chatSession.updateMany({
    where: { id: sessionId, groupId, memberId: member.id },
    data: { title: trimmed, titleEdited: true },
  })
}

export async function deleteChatSession(
  groupId: string,
  sessionId: string,
): Promise<void> {
  const { member } = await requireGroupMember(groupId)
  await prisma.$transaction(async (tx) => {
    const owned = await tx.chatSession.findFirst({
      where: { id: sessionId, groupId, memberId: member.id },
      select: { id: true },
    })
    if (!owned) return
    await tx.chatMessage.deleteMany({ where: { sessionId: owned.id } })
    await tx.chatSession.delete({ where: { id: owned.id } })
  })
}
