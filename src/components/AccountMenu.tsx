'use client'

import { usePathname, useRouter } from 'next/navigation'
import { signOutAction, switchAccountAction } from '@/app/account/actions'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * The account AND group-management menu, in the header's top-right corner.
 *
 * The left-hand text index answers "where do I want to look?" — four
 * reading destinations and nothing else. This menu answers "what do I want
 * to change?": the account itself, and the group as a thing that is
 * created, left, invited into and added to (owner, 2026-08-22). Those two
 * questions were previously mixed across both controls, which is why every
 * screen was reachable from two places and nothing felt like it had a home.
 *
 * The group rows appear only inside a group, resolved from the path the
 * same way `NavIndex` does it — no server data is needed to know which
 * group you are looking at.
 *
 * TEXT ONLY (FIXES §3). Every icon is gone — a menu of six lines does not
 * need six pictograms to be read, and the pictograms were the last
 * decorative element in the chrome. The surface is white, one 1px #dcdcdc
 * border, radius 0, no shadow; hairlines separate the GROUPS, not the rows.
 * The trigger is the bare initial: no box, no inversion, a secondary link's
 * underline on hover.
 */

export function AccountMenu({
  name,
  email,
  labels,
}: {
  name: string
  email: string
  labels: {
    menu: string
    settings: string
    newGroup: string
    manageGroup: string
    invite: string
    switchAccount: string
    signOut: string
  }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const segment = pathname.match(/^\/groups\/([^/]+)/)?.[1]
  const groupId = segment !== undefined && segment !== 'new' ? segment : null
  const initial = (name || email || '?').slice(0, 1).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={labels.menu}
        data-testid="account-menu"
        // A §1 secondary link wearing a single letter: the underline grows
        // from the left on hover, and nothing boxes it in.
        className="inline-flex h-11 items-center bg-[linear-gradient(var(--foreground),var(--foreground))] bg-[length:0%_1px] bg-[position:left_bottom_11px] bg-no-repeat px-2 text-[15px] text-foreground uppercase transition-[background-size] duration-fast ease-swift outline-none select-none hover:bg-[length:100%_1px] active:translate-y-px"
      >
        <span aria-hidden="true">{initial}</span>
      </DropdownMenuTrigger>

      {/* The surface, the rows and the group rule are §3's, and they are
          the DEFAULTS in ui/dropdown-menu.tsx — §4's currency picker opens
          "the same bordered menu as §3", so there is one menu, not two. */}
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="flex min-w-0 flex-col">
            <span
              className="truncate text-[14.5px] text-foreground"
              data-testid="menu-name"
            >
              {name}
            </span>
            <span className="truncate text-[12px] text-[#8a8a8a]">{email}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Managing THIS group: renaming it, adding someone by name,
            leaving it — all of that is the settings screen, and the invite
            link is its one-tap sibling. */}
        {groupId ? (
          <>
            <DropdownMenuItem
              data-testid="menu-manage-group"
              onSelect={() => router.push(`/groups/${groupId}/settings`)}
            >
              {labels.manageGroup}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="menu-invite"
              onSelect={() => router.push(`/groups/${groupId}/invite`)}
            >
              {labels.invite}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem
          data-testid="menu-new-group"
          onSelect={() => router.push('/groups/new')}
        >
          {labels.newGroup}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-testid="menu-account"
          onSelect={() => router.push('/account')}
        >
          {labels.settings}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="menu-switch-account"
          onSelect={() => void switchAccountAction()}
        >
          {labels.switchAccount}
        </DropdownMenuItem>
        {/* Signing out is not destructive — nothing is lost by it — so it
            stays grey rather than taking the app's one chromatic colour. */}
        <DropdownMenuItem
          className="text-[#8a8a8a]"
          data-testid="menu-signout"
          onSelect={() => void signOutAction()}
        >
          {labels.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
