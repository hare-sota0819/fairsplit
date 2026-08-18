'use client'

import { useState, useTransition } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { Check, MessageSquare, MoreHorizontal, Trash2, X } from 'lucide-react'
import { NavLink } from '@/components/NavLoader'
import { cn } from '@/lib/utils'
import type { ChatSessionRow } from '@/lib/chat-history'
import {
  deleteChatSession,
  renameChatSession,
} from '@/app/groups/[groupId]/chat-session-actions'
import { useSidebar } from './SidebarProvider'

const rowClassName =
  'rounded-lg px-2 py-2 text-sm text-foreground transition-colors duration-fast hover:bg-muted active:bg-muted'
const activeRowClassName = 'bg-primary-soft font-semibold text-primary'

/**
 * The reference-app-style conversation list (R2b, docs/PROMPT.md 2026-08-15 — the
 * owner's screenshot of the reference app's "채팅 및 작업" section): every past chat
 * session of MINE in this group, newest first, tappable to reopen and
 * continue; "새 대화" starts a fresh one (`?s=new`, no row created until
 * the first message). The ⋯ menu on each row flips it into an inline
 * rename/delete strip — no separate screen, per the everything-in-chat
 * principle.
 */
export function SidebarSessions({
  groupId,
  sessions,
  ...view
}: {
  groupId: string
  sessions: ChatSessionRow[]
} & (
  | {
      /** Compact rows under the drawer's "Recents" label (no time). */
      variant?: 'drawer'
    }
  | {
      /** The full /chats list (the reference app's "채팅" screen): card rows with a
       *  relative "14시간 전" line. `now` is server-stamped so SSR and
       *  hydration agree. */
      variant: 'page'
      now: number
    }
)) {
  const t = useTranslations('nav.sessions')
  const tLoading = useTranslations('loading')
  const format = useFormatter()
  const isPage = view.variant === 'page'
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [, startTransition] = useTransition()
  // Optimistic overlays: a rename/delete shows instantly; the server
  // action + router.refresh() reconcile in the background (the refresh's
  // RSC propagation can lag while the drawer is open — e2e-observed).
  const [renamed, setRenamed] = useState<Record<string, string>>({})
  const [removed, setRemoved] = useState<Set<string>>(new Set())

  const visibleSessions = sessions
    .filter((session) => !removed.has(session.id))
    .map((session) =>
      renamed[session.id] !== undefined
        ? { ...session, title: renamed[session.id] }
        : session,
    )

  const base = `/groups/${groupId}`
  // Which row is "here": published by the chat page's transcript provider
  // (SidebarProvider.activeSessionId). Deliberately not read from the URL
  // with next/navigation hooks — a lone useSearchParams() mounted inside
  // the Radix drawer content WEDGES the app-router client (bisected,
  // n=2, 2026-08-15) — and a mount-time window.location read went stale
  // on the always-mounted desktop rail.
  const { activeSessionId: activeId } = useSidebar()

  const commitRename = (id: string) => {
    const title = draftTitle.trim()
    setEditingId(null)
    if (title === '') return
    setRenamed((prev) => ({ ...prev, [id]: title }))
    // No router.refresh(): the optimistic overlay shows the result now and
    // the next real navigation reconciles — a refresh from inside the
    // drawer is exactly the churn the hook ban above exists to avoid.
    startTransition(async () => {
      await renameChatSession(groupId, id, title)
    })
  }

  const removeSession = (id: string) => {
    setEditingId(null)
    setRemoved((prev) => new Set(prev).add(id))
    startTransition(async () => {
      await deleteChatSession(groupId, id)
    })
  }

  return (
    <div
      className={cn('flex flex-col', isPage ? 'gap-2' : 'gap-0.5')}
      data-testid="sidebar-sessions"
    >
      {visibleSessions.map((session) =>
        editingId === session.id ? (
          <div
            key={session.id}
            className="flex items-center gap-1 rounded-lg px-2 py-1"
            data-testid={`sidebar-session-edit-${session.id}`}
          >
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename(session.id)
                if (event.key === 'Escape') setEditingId(null)
              }}
              aria-label={t('renameLabel')}
              className="h-8 w-full min-w-0 rounded-md border border-border bg-background px-2 text-sm"
              data-testid="sidebar-session-rename-input"
            />
            <button
              type="button"
              onClick={() => commitRename(session.id)}
              aria-label={t('renameSave')}
              className="rounded-md p-1.5 hover:bg-muted"
              data-testid="sidebar-session-rename-save"
            >
              <Check aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => removeSession(session.id)}
              aria-label={t('delete')}
              className="rounded-md p-1.5 text-negative hover:bg-negative-soft"
              data-testid="sidebar-session-delete"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setEditingId(null)}
              aria-label={t('renameCancel')}
              className="rounded-md p-1.5 hover:bg-muted"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        ) : (
          <div key={session.id} className="group/session relative flex items-center">
            <NavLink
              href={`${base}?s=${session.id}`}
              caption={tLoading('general')}
              testId={`sidebar-session-${session.id}`}
              ariaCurrent={activeId === session.id ? 'page' : undefined}
              className={cn(
                rowClassName,
                'flex min-w-0 flex-1 items-center gap-2 pr-8',
                isPage &&
                  'gap-3 rounded-xl border border-border bg-card px-3 py-3 pr-10 hover:bg-muted/60',
                activeId === session.id && activeRowClassName,
              )}
            >
              <MessageSquare
                aria-hidden="true"
                className={cn(
                  'size-4 shrink-0 text-muted-foreground',
                  isPage &&
                    'size-9 rounded-full bg-primary-soft p-2 text-foreground/80',
                )}
              />
              {isPage ? (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-base">{session.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {format.relativeTime(new Date(session.lastMessageAt), view.variant === 'page' ? view.now : undefined)}
                  </span>
                </span>
              ) : (
                <span className="truncate">{session.title}</span>
              )}
            </NavLink>
            <button
              type="button"
              onClick={() => {
                setEditingId(session.id)
                setDraftTitle(session.title)
              }}
              aria-label={t('rowMenu')}
              className={cn(
                'absolute right-1 rounded-md p-1.5 text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:opacity-100',
                isPage && 'right-2',
              )}
              data-testid={`sidebar-session-menu-${session.id}`}
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </button>
          </div>
        ),
      )}
    </div>
  )
}
