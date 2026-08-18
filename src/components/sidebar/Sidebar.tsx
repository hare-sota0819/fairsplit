'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import {
  ArrowLeftRight,
  CircleHelp,
  History,
  LogOut,
  MessagesSquare,
  Plus,
  Scale,
  Settings,
  SquarePen,
  User,
  UserPlus,
  UserRoundCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { NavLink } from '@/components/NavLoader'
import { cn } from '@/lib/utils'
import type { ChatSessionRow } from '@/lib/chat-history'
import { signOutAction } from '@/app/account/actions'
import { useSidebar } from './SidebarProvider'
import { SidebarSessions } from './SidebarSessions'

export interface SidebarItem {
  key: string
  href: string
  label: string
  testid: string
  /**
   * Loading-overlay caption for this item's destination (e.g.
   * `loading.status`). Falls back to `loading.general` when omitted — most
   * items have no tailored `loading.*` entry to reach for.
   */
  caption?: string
}

// Press tint mirrors the hover delta onto :active (## Press states
// derivation rule) at --dur-fast.
const itemClassName =
  'rounded-lg px-2 py-2 text-sm text-foreground transition-colors duration-fast hover:bg-muted active:bg-muted'
const activeItemClassName = 'bg-primary-soft font-semibold text-primary'

// One icon per nav row (reference-app parity). Keyed on `SidebarItem.key`.
const NAV_ICONS: Record<string, LucideIcon> = {
  chats: MessagesSquare,
  history: History,
  status: Scale,
  me: User,
  exchange: Wallet,
  manualEntry: SquarePen,
  invite: UserPlus,
  settings: Settings,
}

// Keys that live in the account sheet (bottom-left avatar), not the nav.
const ACCOUNT_KEYS = new Set(['allGroups', 'newGroup', 'account', 'guide'])

/** Width of the desktop rail — the header and the group shell offset by
 *  the same amount (Tailwind `w-72` / `pl-72`). */
export const RAIL_WIDTH_CLASS = 'lg:pl-72'

interface SidebarProps {
  groupName: string
  /** "🇯🇵 Sapporo, Japan" — already formatted, or null. */
  destination: string | null
  items: SidebarItem[]
  /** R2b: the member's chat sessions in this group, newest first. */
  sessions?: ChatSessionRow[]
  userName: string
  userEmail: string
}

/**
 * The app's nav, rebuilt 2026-08-16 to the owner's reference — the reference chat
 * app's hamburger drawer, copied 1:1 in structure — and rendered TWICE from
 * one body: as a slide-in drawer on phones (Radix Dialog) and as an
 * always-mounted left rail at `lg`+ (the reference app's persistent sidebar).
 *
 *   pinned top     wordmark, and under it which group this is
 *   scroll         the nav rows (Chats first — it opens the full chat list
 *                  page, like the reference app's "채팅"), then "Recents": this group's
 *                  chat sessions inline
 *   pinned bottom  a round avatar button (opens the account sheet: switch
 *                  group / new group / guide / account / sign out) and the
 *                  floating "+ New chat" pill — always under the thumb
 *
 * The group switcher list is GONE (owner: "you don't change groups
 * mid-trip; that belongs in settings like a mode switch") — switching is
 * one row in the account sheet, to /groups.
 *
 * Drawer links do NOT close the panel on click — `SidebarProvider` closes it
 * on every pathname/query change, so a tapped link's own loading overlay
 * stays up until the route commits.
 */
export function Sidebar(props: SidebarProps) {
  const { open, setOpen, setRegistered } = useSidebar()
  const [accountOpen, setAccountOpen] = useState(false)
  // The rail's BODY mounts only when the desktop media query matches. The
  // aside shell itself is CSS-hidden below lg, but a hidden body would still
  // be in the DOM — duplicating every `sidebar-*` testid/label the phone
  // drawer renders (Playwright strict-mode violations at 390px, and two
  // identical accessible landmarks). SSR renders no body (false), so on
  // desktop it appears one hydration beat after the shell — the shell's
  // fixed background is already there, so nothing shifts.
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    const apply = () => setDesktop(mql.matches)
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [])

  // Tells `SidebarToggle` a sidebar actually exists on this route, so it
  // never renders a hamburger with nothing behind it (e.g. a group 404).
  useEffect(() => {
    setRegistered(true)
    return () => setRegistered(false)
  }, [setRegistered])

  return (
    <>
      {/* Desktop rail (lg+). The hamburger is hidden at this width
          (SidebarToggle), so the dialog below never opens there. */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col border-r border-border bg-card lg:flex"
        data-testid="sidebar-rail"
      >
        {desktop ? (
          <SidebarBody
            {...props}
            inDialog={false}
            accountOpen={accountOpen}
            setAccountOpen={setAccountOpen}
          />
        ) : null}
      </aside>

      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setAccountOpen(false)
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              'fixed inset-0 z-50 bg-scrim',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
              'duration-base ease-out',
            )}
          />
          <DialogPrimitive.Content
            data-testid="sidebar-panel"
            className={cn(
              // `h-dvh` (not inset-y-0 alone): iOS toolbars change the
              // viewport height under a fixed sheet, and the middle section
              // needs a real bounded height to scroll inside — the owner's
              // "스크롤이 안 됨" on the phone.
              'fixed top-0 left-0 z-50 flex h-dvh w-80 max-w-[85vw] flex-col',
              'bg-card shadow-lg',
              'data-[state=open]:animate-in data-[state=open]:slide-in-from-left',
              'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left',
              'duration-slow ease-swift',
            )}
          >
            <SidebarBody
              {...props}
              inDialog
              accountOpen={accountOpen}
              setAccountOpen={setAccountOpen}
            />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

/** The drawer's / rail's contents — identical in both, so the phone
 *  drawer and the desktop rail can never drift apart. */
function SidebarBody({
  inDialog,
  groupName,
  destination,
  items,
  sessions = [],
  userName,
  userEmail,
  accountOpen,
  setAccountOpen,
}: SidebarProps & {
  inDialog: boolean
  accountOpen: boolean
  setAccountOpen: (next: boolean | ((v: boolean) => boolean)) => void
}) {
  const t = useTranslations('loading')
  const tApp = useTranslations('app')
  const tNav = useTranslations('nav')
  const pathname = usePathname()

  const byKey = (key: string) => {
    const item = items.find((i) => i.key === key)
    if (!item) {
      // `SidebarData` always supplies these — a miss is a caller regression.
      throw new Error(`Sidebar: items is missing '${key}'`)
    }
    return item
  }
  const chatsItem = byKey('chats')
  const allGroupsItem = byKey('allGroups')
  const newGroupItem = byKey('newGroup')
  const accountItem = byKey('account')
  const guideItem = byKey('guide')
  const navItems = items.filter((item) => !ACCOUNT_KEYS.has(item.key))
  const chatBase = chatsItem.href.replace(/\/chats$/, '')
  const groupId = chatBase.split('/').pop() ?? ''

  const initial = (userName || userEmail || '?').slice(0, 1).toUpperCase()

  return (
    <>
      {/* Pinned top: wordmark, then which group we're in (the reference app puts its
          wordmark alone; ours needs the group named somewhere since the
          page header no longer carries it). */}
      <div className="flex shrink-0 flex-col gap-0.5 px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-2">
        <NavLink
          href="/"
          caption={t('general')}
          className="w-fit rounded-lg px-2 pt-1 pb-1 text-xl font-bold tracking-tight text-foreground transition-colors duration-fast hover:text-primary"
        >
          {tApp('name')}
        </NavLink>
        {inDialog ? (
          <>
            <DialogPrimitive.Title className="truncate px-2 text-sm font-medium text-foreground">
              {groupName}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              className={cn(
                'truncate px-2 text-xs text-muted-foreground',
                destination === null && 'sr-only',
              )}
              data-testid="sidebar-destination"
            >
              {destination ?? groupName}
            </DialogPrimitive.Description>
          </>
        ) : (
          <>
            <p className="truncate px-2 text-sm font-medium text-foreground">
              {groupName}
            </p>
            {destination !== null ? (
              <p className="truncate px-2 text-xs text-muted-foreground">
                {destination}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* Scrollable middle: nav rows, then Recents (sessions). The
          scrollbar stays out of the content column via padding on the
          scroller and `scrollbar-gutter`. */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 pt-2 pb-24 [scrollbar-gutter:stable] [scrollbar-width:thin]">
        <div className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = NAV_ICONS[item.key]
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <NavLink
                key={item.key}
                href={item.href}
                caption={item.caption ?? t('general')}
                testId={item.testid}
                ariaCurrent={isActive ? 'page' : undefined}
                className={cn(
                  itemClassName,
                  'flex items-center gap-3',
                  isActive && activeItemClassName,
                )}
              >
                {Icon ? (
                  <Icon
                    aria-hidden="true"
                    className="size-[18px] shrink-0 text-foreground/80"
                  />
                ) : null}
                <span className="truncate">{item.label}</span>
              </NavLink>
            )
          })}
        </div>

        <p className="truncate px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
          {tNav('sessions.recent')}
        </p>
        <Suspense fallback={null}>
          <SidebarSessions groupId={groupId} sessions={sessions} />
        </Suspense>
      </div>

      {/* Pinned bottom (floating, reference-app parity): avatar → account sheet;
          "+ New chat" pill. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-card via-card/90 to-transparent px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto relative">
          {accountOpen ? (
            <div
              className="absolute bottom-full left-0 mb-2 flex w-64 flex-col gap-0.5 rounded-xl border border-border bg-card p-2 shadow-lg"
              data-testid="sidebar-account-sheet"
            >
              <div className="flex min-w-0 flex-col px-2 py-1.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {userName}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {userEmail}
                </span>
              </div>
              <div className="my-1 h-px bg-border" />
              <p className="truncate px-2 pt-1 text-xs text-muted-foreground">
                {tNav('sidebar.currentGroup')} · {groupName}
              </p>
              <NavLink
                href={allGroupsItem.href}
                caption={t('general')}
                testId={allGroupsItem.testid}
                className={cn(itemClassName, 'flex items-center gap-3')}
              >
                <ArrowLeftRight aria-hidden="true" className="size-4 shrink-0 text-chevron" />
                <span className="truncate">{tNav('sidebar.switchGroup')}</span>
              </NavLink>
              <NavLink
                href={newGroupItem.href}
                caption={t('general')}
                testId={newGroupItem.testid}
                className={cn(itemClassName, 'flex items-center gap-3')}
              >
                <Plus aria-hidden="true" className="size-4 shrink-0 text-chevron" />
                <span className="truncate">{newGroupItem.label}</span>
              </NavLink>
              <div className="my-1 h-px bg-border" />
              <NavLink
                href={guideItem.href}
                caption={t('general')}
                testId={guideItem.testid}
                className={cn(itemClassName, 'flex items-center gap-3')}
              >
                <CircleHelp aria-hidden="true" className="size-4 shrink-0 text-chevron" />
                <span className="truncate">{guideItem.label}</span>
              </NavLink>
              <NavLink
                href={accountItem.href}
                caption={t('general')}
                testId={accountItem.testid}
                className={cn(itemClassName, 'flex items-center gap-3')}
              >
                <UserRoundCog aria-hidden="true" className="size-4 shrink-0 text-chevron" />
                <span className="truncate">{accountItem.label}</span>
              </NavLink>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className={cn(itemClassName, 'flex w-full items-center gap-3 text-left')}
                  data-testid="sidebar-sign-out"
                >
                  <LogOut aria-hidden="true" className="size-4 shrink-0 text-chevron" />
                  <span className="truncate">{tNav('signOut')}</span>
                </button>
              </form>
            </div>
          ) : null}
          <button
            type="button"
            aria-label={tNav('accountMenu')}
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen((v) => !v)}
            data-testid="sidebar-account-button"
            className="flex size-11 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary shadow-sm transition-[background-color,transform] duration-fast ease-swift hover:brightness-95 active:scale-[0.97]"
          >
            <span aria-hidden="true">{initial}</span>
          </button>
        </div>
        <NavLink
          href={`${chatBase}?s=new`}
          caption={t('general')}
          testId="sidebar-new-chat"
          className="pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-md transition-[transform,filter] duration-fast ease-swift hover:brightness-110 active:scale-[0.97]"
        >
          <Plus aria-hidden="true" className="size-4" />
          <span>{tNav('sessions.newChat')}</span>
        </NavLink>
      </div>
    </>
  )
}
