import { prisma } from '@/lib/prisma'
import { sessionMemorySchema, type ChatSessionRow, type SessionMemory } from '@/lib/chat-history'

/**
 * READ paths for chat sessions — plain server-side functions, NOT server
 * actions. Deliberately split from chat-session-actions.ts: calling a
 * 'use server' action during an RSC RENDER (layout/page) wedged the
 * app-router client — server-action responses (expense cancel, top-ups)
 * stopped applying until reload. Bisected to exactly the layout's
 * listChatSessions call, n=2 each way, 2026-08-15. Actions are for
 * client-invoked calls; render-time reads use these.
 */

const SESSION_LIST_CAP = 100

export async function listSessionRows(
  groupId: string,
  memberId: string,
): Promise<ChatSessionRow[]> {
  const rows = await prisma.chatSession.findMany({
    where: { groupId, memberId },
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
    take: SESSION_LIST_CAP,
    select: { id: true, title: true, lastMessageAt: true },
  })
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    lastMessageAt: r.lastMessageAt.toISOString(),
  }))
}

/** The member's session rows resolved via the USER id — for the layout,
 *  which has the user but has not resolved the member row itself. */
export async function listSessionRowsForUser(
  groupId: string,
  userId: string,
): Promise<ChatSessionRow[]> {
  const member = await prisma.member.findFirst({
    where: { groupId, userId, leftAt: null },
    select: { id: true },
  })
  if (!member) return []
  return listSessionRows(groupId, member.id)
}

export async function readSessionMemory(
  groupId: string,
  memberId: string,
  sessionId: string,
): Promise<SessionMemory | null> {
  const row = await prisma.chatSession.findFirst({
    where: { id: sessionId, groupId, memberId },
    select: { memory: true },
  })
  if (!row?.memory) return null
  const parsed = sessionMemorySchema.safeParse(row.memory)
  return parsed.success ? parsed.data : null
}

/** Wall-clock stamp for relative "14시간 전" labels — a plain function so a
 *  server component can call it (the compiler lint rejects a bare
 *  `Date.now()` inside a component body). */
export function sessionListNow(): number {
  return Date.now()
}
