import { getTranslations } from 'next-intl/server'
import { requireGroupMember } from '@/lib/membership'
import { listSessionRows, sessionListNow } from '@/lib/chat-sessions'
import { ChatsList } from './ChatsList'

/**
 * The full chat-session list — the reference app's "채팅" screen (owner's reference
 * video, 2026-08-16): every conversation of mine in this group as a card
 * row with a relative time, a search box and the "+ New chat" pill pinned
 * to the bottom. Reached from the drawer's first nav row.
 */
export default async function ChatsPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member } = await requireGroupMember(groupId)
  const [sessions, t] = await Promise.all([
    listSessionRows(groupId, member.id),
    getTranslations('nav.sessions'),
  ])
  const now = sessionListNow()
  return (
    <main className="flex flex-1 flex-col gap-4 px-5 pt-4 pb-32">
      <h1 className="text-center text-base font-semibold">{t('pageTitle')}</h1>
      <ChatsList groupId={groupId} sessions={sessions} now={now} />
    </main>
  )
}
