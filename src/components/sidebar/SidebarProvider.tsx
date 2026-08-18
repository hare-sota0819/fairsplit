'use client'

import { createContext, Suspense, useContext, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
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
  open: boolean
  setOpen: (open: boolean) => void
  /** Whether a `Sidebar` is actually mounted on the current route right now. */
  registered: boolean
  setRegistered: (registered: boolean) => void
  /** The chat session the page is showing (null on ?s=new until its first
   *  message adopts a row, and off the chat page). Set by the page's
   *  `ChatTranscriptProvider`; read by the sidebar's session rows so the
   *  always-mounted desktop rail highlights the right one. */
  activeSessionId: string | null
  setActiveSessionId: (id: string | null) => void
  panel: ContextPanelState | null
  setPanel: (panel: ContextPanelState | null) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

/**
 * Sidebar open/closed state, lifted to the root layout so both the header's
 * hamburger (which opens it) and the sidebar itself (which reads it) share
 * one source of truth without prop-drilling through every route.
 *
 * Closes on every pathname change, rather than each link closing it on
 * click. Two reasons: (1) leaving the group subtree via the back
 * gesture/button also closes it — with a per-link close, Back left `open`
 * stuck true, so the drawer sprang open again on the next group entered;
 * (2) the panel stays mounted THROUGH a pending navigation, so a tapped
 * link's own `NavLink` loading overlay (portalled to `document.body`) stays
 * visible until the new route commits, instead of being torn down with the
 * panel the instant the link is pressed — the same "own the wait" contract
 * the now-deleted `Tabs.tsx` used to document (Task 6, app-shell
 * restructure: the sidebar is the only nav now).
 *
 * Implemented as React's documented "adjusting state when a prop changes"
 * pattern (a render-time comparison + conditional `setState`, not an
 * effect): this both avoids a `react-hooks/set-state-in-effect` suppression
 * and — the actual reason it matters here — closes the drawer in the SAME
 * commit as the pathname change, rather than one paint later. An
 * effect-based close let the new page render for a single frame with the
 * old page's drawer still open on top of it.
 */
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [panel, setPanel] = useState<ContextPanelState | null>(null)
  const pathname = usePathname()
  const [lastPathname, setLastPathname] = useState(pathname)

  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpen(false)
    // The panel answers a question asked on THIS chat page; leaving the
    // page ends it (same render-time close as the drawer).
    setPanel(null)
  }

  return (
    <SidebarContext.Provider
      value={{
        open,
        setOpen,
        registered,
        setRegistered,
        activeSessionId,
        setActiveSessionId,
        panel,
        setPanel,
      }}
    >
      {/* R2b sessions: session links navigate by QUERY only (?s=…), which
          the pathname comparison above never sees — the watcher below
          applies the same render-time close to query changes. Suspense
          because useSearchParams suspends during SSR; state lives in the
          child so the whole provider never suspends. A per-link
          setOpen(false) was tried first and FROZE the drawer (Radix panel
          stuck mounted at data-state=closed after closing mid-pending-
          navigation — e2e-reproduced 2026-08-15); closing in the same
          commit as the committed navigation, like the pathname close, does
          not. */}
      <Suspense fallback={null}>
        <QueryCloser open={open} setOpen={setOpen} />
      </Suspense>
      {children}
    </SidebarContext.Provider>
  )
}

function QueryCloser({
  setOpen,
}: {
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  // An EFFECT, unlike the provider's own render-time pathname compare: a
  // child may not set its parent's state during render (React drops the
  // update with a console error — which is exactly how the first version
  // of this watcher silently failed and left `open` stuck true). One paint
  // of drawer-over-new-page is the accepted cost.
  const lastQueryRef = useRef(query)
  useEffect(() => {
    if (query === lastQueryRef.current) return
    lastQueryRef.current = query
    setOpen(false)
  }, [query, setOpen])
  return null
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return ctx
}
