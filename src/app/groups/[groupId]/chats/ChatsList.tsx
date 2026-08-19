'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Search } from 'lucide-react'
import { NavLink } from '@/components/NavLoader'
import { SidebarSessions } from '@/components/sidebar/SidebarSessions'
import { useSidebar } from '@/components/sidebar/SidebarProvider'
import { cn } from '@/lib/utils'
import type { ChatSessionRow } from '@/lib/chat-history'

/** Client half of /chats: a local title filter over the server-listed
 *  sessions, the shared session rows in their `page` variant, and the
 *  bottom dock (search + "+ New chat"). */
export function ChatsList({
  groupId,
  sessions,
  now,
}: {
  groupId: string
  sessions: ChatSessionRow[]
  now: number
}) {
  const t = useTranslations('nav.sessions')
  const tLoading = useTranslations('loading')
  const { panel } = useSidebar()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const filtered =
    needle === ''
      ? sessions
      : sessions.filter((s) => s.title.toLowerCase().includes(needle))

  return (
    <>
      {sessions.length === 0 ? (
        <p
          className="pt-10 text-center text-sm text-muted-foreground"
          data-testid="chats-empty"
        >
          {t('empty')}
        </p>
      ) : filtered.length === 0 ? (
        <p
          className="pt-10 text-center text-sm text-muted-foreground"
          data-testid="chats-no-match"
        >
          {t('noMatch')}
        </p>
      ) : (
        <SidebarSessions
          groupId={groupId}
          sessions={filtered}
          variant="page"
          now={now}
        />
      )}

      {/* Bottom dock: search on the left, "New chat" on the right, both
          under the thumb; stops before the desktop context panel exactly
          like the chat composer's `DockFrame`. */}
      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]',
          panel !== null && 'lg:right-[26rem]',
        )}
      >
        {/* Same column width as the chat composer's dock, so the two docks
            line up when switching between /chats and a chat. */}
        <div className="mx-auto flex w-full max-w-md items-center gap-3 lg:max-w-2xl">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3 transition-colors duration-fast focus-within:border-ring">
            <Search
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              data-testid="chats-search"
            />
          </label>
          <NavLink
            href={`/groups/${groupId}?s=new`}
            caption={tLoading('general')}
            testId="chats-new-chat"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition-[transform,filter] duration-fast ease-swift hover:brightness-110 active:scale-[0.97]"
          >
            <Plus aria-hidden="true" className="size-4" />
            <span>{t('newChat')}</span>
          </NavLink>
        </div>
      </div>
    </>
  )
}
