'use client'

import { createContext, useContext, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { ExpenseListFilters } from '@/app/groups/[groupId]/chat-query-actions'

/**
 * The desktop context panel (shell phase B, 2026-08-16 — owner: "on PC,
 * 'show the history' / 'what did I spend' should open a third pane on the
 * right, like the reference app's artifact panel"). Opened by ChatComposer on those
 * query intents at `lg`+; rendered by `ContextPanel` in the group shell.
 */
export type ContextPanelState =
  | { kind: 'history'; scope: 'all' | 'mine'; filters: ExpenseListFilters }
  | { kind: 'mySpending' }

interface SidebarContextValue {
  /** The chat session the page is showing (null on ?s=new until its first
   *  message adopts a row, and off the chat page). Set by the page's
   *  `ChatTranscriptProvider`; read by the /chats session rows so the
   *  current one is highlighted. */
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  panel: ContextPanelState | null
  setPanel: (panel: ContextPanelState | null) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

/**
 * Shell state shared across routes: the desktop context panel and the
 * active chat session. (The sidebar drawer this provider was named for is
 * gone — navigation is the header's in-place text index, docs/BRAND.md v2
 * §3 — but the name stays so its many consumers did not have to move.)
 *
 * The panel answers a question asked on THIS chat page; leaving the page
 * ends it. Closed via React's documented "adjusting state when a prop
 * changes" pattern (a render-time comparison + conditional `setState`, not
 * an effect), so it closes in the SAME commit as the pathname change
 * rather than one paint later.
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [panel, setPanel] = useState<ContextPanelState | null>(null)
  const pathname = usePathname()
  const [lastPathname, setLastPathname] = useState(pathname)

  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setPanel(null)
  }

  return (
    <SidebarContext.Provider
      value={{
        activeSessionId,
        setActiveSessionId,
        panel,
        setPanel,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return ctx
}
