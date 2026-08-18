import { getTranslations } from 'next-intl/server'
import { Sidebar, type SidebarItem } from '@/components/sidebar/Sidebar'
import { prisma } from '@/lib/prisma'
import { listSessionRowsForUser } from '@/lib/chat-sessions'
import { destinationFor, flagEmoji } from '@/lib/destinations'

/**
 * Server-side data loader for the sidebar: the caller (the group layout)
 * has already resolved membership via `requireGroupMember`, so this only
 * needs the ids to fetch the group switcher list and build the translated
 * item labels — no session lookup of its own.
 */
export async function SidebarData({
  groupId,
  userId,
  userName,
  userEmail,
}: {
  groupId: string
  userId: string
  userName: string
  userEmail: string
}) {
  const [group, sessions, t, tExchange, tAccount, tLoading] = await Promise.all([
    prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { name: true, tripCity: true, tripCountry: true },
    }),
    listSessionRowsForUser(groupId, userId),
    getTranslations('nav'),
    getTranslations('exchange'),
    getTranslations('account'),
    getTranslations('loading'),
  ])

  const base = `/groups/${groupId}`
  const destination = destinationFor(group.tripCountry ?? '')
  const destinationLabel = destination
    ? `${flagEmoji(destination.code)} ${
        group.tripCity ? `${group.tripCity}, ${destination.name}` : destination.name
      }`
    : null
  const items: SidebarItem[] = [
    {
      // the reference app's "채팅" row: opens the full chat-session list page.
      key: 'chats',
      href: `${base}/chats`,
      label: t('sidebar.chats'),
      testid: 'sidebar-chats',
    },
    {
      key: 'history',
      href: `${base}/history`,
      label: t('sidebar.history'),
      testid: 'sidebar-history',
    },
    {
      key: 'status',
      href: `${base}/status`,
      label: t('tabs.status'),
      testid: 'sidebar-status',
      caption: tLoading('status'),
    },
    {
      key: 'me',
      href: `${base}/me`,
      label: t('tabs.me'),
      testid: 'sidebar-me',
      caption: tLoading('me'),
    },
    {
      // Wallet management lives on the existing /exchange screen (its own
      // title IS "Wallets & top-ups"/"지갑과 충전") — there is no separate
      // /wallets route, so this label is the screen's own heading rather
      // than a sidebar-only string, and the two now read as the same place.
      key: 'exchange',
      href: `${base}/exchange`,
      label: tExchange('title'),
      testid: 'sidebar-exchange',
      caption: tLoading('exchange'),
    },
    {
      key: 'manualEntry',
      href: `${base}/expenses/new`,
      label: t('sidebar.manualEntry'),
      testid: 'sidebar-manual-entry',
      // Same destination the old FAB pointed at, and the same caption it
      // used (`Tabs.tsx`'s `add` item read `tLoading('expense')` too).
      caption: tLoading('expense'),
    },
    {
      key: 'invite',
      href: `${base}/invite`,
      label: t('sidebar.invite'),
      testid: 'sidebar-invite',
    },
    {
      key: 'settings',
      href: `${base}/settings`,
      label: t('tabs.settings'),
      testid: 'sidebar-settings',
    },
    {
      key: 'allGroups',
      href: '/groups',
      label: t('sidebar.allGroups'),
      testid: 'sidebar-all-groups',
    },
    {
      key: 'account',
      href: '/account',
      label: tAccount('title'),
      testid: 'sidebar-account',
    },
    {
      key: 'guide',
      href: '/guide',
      label: tAccount('guide'),
      testid: 'sidebar-guide',
    },
    {
      // Same destination and label the header's `AccountMenu` "New group"
      // row already uses — reused here for the drawer's own quieter row
      // under the inline group switcher.
      key: 'newGroup',
      href: '/groups/new',
      label: t('newGroup'),
      testid: 'sidebar-new-group',
    },
  ]

  return (
    <Sidebar
      groupName={group.name}
      destination={destinationLabel}
      items={items}
      sessions={sessions}
      userName={userName}
      userEmail={userEmail}
    />
  )
}
