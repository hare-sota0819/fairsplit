'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { NavLink } from '@/components/NavLoader'
import { cn } from '@/lib/utils'

/**
 * The app's navigation: an in-place expanding text index (docs/BRAND.md v2
 * §3, the fey.com grammar). Three short hairlines at the top-left; on
 * hover (pointer devices) they fade out and a vertical list of plain text
 * links materialises where they were — each item resolves from blur(4px)
 * / opacity 0 to sharp over 200ms, cascading top-to-bottom with a 45ms
 * stagger; nothing slides, nothing beneath moves. On touch a tap toggles.
 * When the pointer leaves, a 200ms grace delay holds the list open, then
 * the whole list blurs out together (140ms, no reverse stagger) and the
 * mark fades back in. No panel, no backdrop, no shadow: the links sit
 * straight on the page. The current route's link is full ink; the rest
 * are muted and darken toward ink on hover.
 *
 * Path-driven and client-side: on `/groups/<id>` (not `/groups/new`) it
 * lists that group's screens, then the account-level rows; elsewhere the
 * account-level rows alone. Nothing here needs server data — the labels
 * are i18n keys, the hrefs are built from the pathname.
 */

// Open: 200ms blur-to-sharp per item (globals.css `.nav-index-item`),
// 45ms stagger; close: 200ms grace, then 140ms joint blur-out.
const OPEN_STAGGER_MS = 45
const CLOSE_GRACE_MS = 200
const CLOSE_MS = 140

interface IndexItem {
  key: string
  href: string
  label: string
  caption: string
  testid: string
  /** Match the current route by prefix (default) or exactly. */
  exact?: boolean
  /** An extra exact pathname that also counts as this item's route. */
  alsoActiveAt?: string
}

function useGroupId(): string | null {
  const pathname = usePathname()
  const segment = pathname.match(/^\/groups\/([^/]+)/)?.[1]
  return segment !== undefined && segment !== 'new' ? segment : null
}

export function NavIndex({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname()
  const groupId = useGroupId()
  const t = useTranslations('nav')
  const tExchange = useTranslations('exchange')
  const tLoading = useTranslations('loading')

  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const graceRef = useRef<number | null>(null)
  const closeRef = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const clearTimers = useCallback(() => {
    if (graceRef.current !== null) window.clearTimeout(graceRef.current)
    if (closeRef.current !== null) window.clearTimeout(closeRef.current)
    graceRef.current = null
    closeRef.current = null
  }, [])

  const openNow = useCallback(() => {
    clearTimers()
    setClosing(false)
    setOpen(true)
  }, [clearTimers])

  /** Blur/fade the whole list out together, then unmount it. */
  const closeNow = useCallback(() => {
    clearTimers()
    setClosing(true)
    closeRef.current = window.setTimeout(() => {
      setClosing(false)
      setOpen(false)
      closeRef.current = null
    }, CLOSE_MS)
  }, [clearTimers])

  /** The pointer left: hold the grace delay before closing. */
  const scheduleClose = useCallback(() => {
    if (graceRef.current !== null) window.clearTimeout(graceRef.current)
    graceRef.current = window.setTimeout(() => {
      graceRef.current = null
      closeNow()
    }, CLOSE_GRACE_MS)
  }, [closeNow])

  useEffect(() => clearTimers, [clearTimers])

  // Route change: the index has done its job — close in the same commit.
  const [lastPathname, setLastPathname] = useState(pathname)
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpen(false)
    setClosing(false)
  }

  // Escape closes; a click outside closes (touch users have no leave).
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNow()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) closeNow()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [open, closeNow])

  // FOUR destinations, nothing else (owner, 2026-08-22). Everything that
  // manages the group rather than reading it — creating a group, leaving
  // one, adding a person, the invite link, group settings — moved to the
  // account menu on the right; the screens that only qualified numbers
  // (history, checkpoints, change requests, the mode comparison) are
  // reached from the screen whose numbers they qualify, not from here.
  const groupItems: IndexItem[] = groupId
    ? [
        {
          key: 'exchange',
          href: `/groups/${groupId}/exchange`,
          label: tExchange('title'),
          caption: tLoading('exchange'),
          testid: 'nav-exchange',
        },
        {
          key: 'me',
          href: `/groups/${groupId}/me`,
          label: t('tabs.me'),
          caption: tLoading('me'),
          testid: 'nav-me',
        },
        {
          key: 'status',
          href: `/groups/${groupId}/status`,
          label: t('tabs.status'),
          caption: tLoading('status'),
          testid: 'nav-status',
        },
      ]
    : []

  const accountItems: IndexItem[] = [
    {
      key: 'allGroups',
      href: '/groups',
      label: t('sidebar.allGroups'),
      caption: tLoading('general'),
      testid: 'nav-all-groups',
      exact: true,
    },
  ]

  const isActive = (item: IndexItem) =>
    pathname === item.alsoActiveAt ||
    (item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`))

  // The pointer type of the last press: hover opens for a mouse, so its
  // click must not immediately toggle the index shut again; a touch has no
  // hover, so its tap is the toggle.
  const lastPointerRef = useRef<string>('mouse')

  const renderItems = (items: IndexItem[], offset: number) =>
    items.map((item, i) => (
      <li
        key={item.key}
        className="nav-index-item"
        style={{ ['--nav-delay' as string]: `${(offset + i) * OPEN_STAGGER_MS}ms` }}
      >
        <NavLink
          href={item.href}
          caption={item.caption}
          testId={item.testid}
          ariaCurrent={isActive(item) ? 'page' : undefined}
          className={cn(
            'block py-[3px] text-[13px] leading-[1.5] whitespace-nowrap uppercase outline-none transition-colors duration-fast',
            isActive(item)
              ? 'text-primary'
              : 'text-muted-foreground hover:text-primary focus-visible:text-primary',
          )}
        >
          {item.label}
        </NavLink>
      </li>
    ))

  const showList = open || closing
  // The mark (and wordmark) are gone while the list stands; they start
  // fading back the moment the list starts blurring out — a crossfade.
  const markHidden = open && !closing

  return (
    <div
      ref={rootRef}
      className="relative flex items-center gap-1"
      data-testid="nav-index-root"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') openNow()
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse' && open) scheduleClose()
      }}
      onFocus={openNow}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          scheduleClose()
        }
      }}
    >
      {/* The mark: three short hairlines. Fades out while the list is up;
          stays in the layout so nothing shifts. */}
      <button
        type="button"
        aria-label={t('sidebar.open')}
        aria-expanded={open}
        aria-controls="nav-index-list"
        data-testid="nav-index-toggle"
        onPointerDown={(event) => {
          lastPointerRef.current = event.pointerType
        }}
        onClick={() => {
          if (!open) openNow()
          else if (lastPointerRef.current !== 'mouse') closeNow()
        }}
        className={cn(
          'flex size-10 flex-col items-start justify-center gap-[5px] px-2 outline-none transition-opacity duration-fast',
          markHidden ? 'opacity-0' : 'opacity-100',
        )}
      >
        <span aria-hidden="true" className="block h-0.5 w-4 bg-primary" />
        <span aria-hidden="true" className="block h-0.5 w-4 bg-primary" />
        <span aria-hidden="true" className="block h-0.5 w-4 bg-primary" />
      </button>
      {/* The wordmark sits beside the mark and fades with it: the links
          take exactly the place the two occupied. */}
      <div
        className={cn(
          'transition-opacity duration-fast',
          markHidden && 'pointer-events-none opacity-0',
        )}
      >
        {children}
      </div>

      {showList ? (
        <ul
          id="nav-index-list"
          data-testid="nav-index"
          data-state={closing ? 'closing' : 'open'}
          className={cn(
            // Absolutely positioned where the mark sits, straight on the
            // page: no panel, no border, no shadow, no backdrop — content
            // beneath never moves. It does carry the PAGE's own colour
            // behind the type (invisible on paper, no edge, no elevation):
            // an app screen, unlike a hero, has copy right under the
            // top-left corner, and links set over another line of text
            // are unreadable in either theme.
            'absolute top-0 -left-1 z-40 m-0 flex w-max list-none flex-col bg-background py-1 pr-6 pl-3',
            closing && 'nav-index-closing',
          )}
        >
          {renderItems(groupItems, 0)}
          {groupItems.length > 0 ? (
            <li aria-hidden="true" className="h-3" />
          ) : null}
          {renderItems(accountItems, groupItems.length)}
        </ul>
      ) : null}
    </div>
  )
}
