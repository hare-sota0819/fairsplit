'use client'

import { usePathname, useRouter } from 'next/navigation'
import { LogOut, Plus, Settings, UserRoundCog, UserRoundPlus, Users } from 'lucide-react'
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
 * The avatar is the first letter of your name. There is no avatar pipeline
 * in this app, and a letter that is actually yours beats a stock silhouette.
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
        className="flex size-8 items-center justify-center border border-border-strong text-[13px] text-primary uppercase outline-none transition-colors duration-fast hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
      >
        <span aria-hidden="true">{initial}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium" data-testid="menu-name">
              {name}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {email}
            </span>
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
              <Users aria-hidden="true" className="size-4 text-chevron" />
              {labels.manageGroup}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="menu-invite"
              onSelect={() => router.push(`/groups/${groupId}/invite`)}
            >
              <UserRoundPlus aria-hidden="true" className="size-4 text-chevron" />
              {labels.invite}
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuItem
          data-testid="menu-new-group"
          onSelect={() => router.push('/groups/new')}
        >
          <Plus aria-hidden="true" className="size-4 text-chevron" />
          {labels.newGroup}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          data-testid="menu-account"
          onSelect={() => router.push('/account')}
        >
          <Settings aria-hidden="true" className="size-4 text-chevron" />
          {labels.settings}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="menu-switch-account"
          onSelect={() => void switchAccountAction()}
        >
          <UserRoundCog aria-hidden="true" className="size-4 text-chevron" />
          {labels.switchAccount}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="menu-signout"
          onSelect={() => void signOutAction()}
        >
          <LogOut aria-hidden="true" className="size-4 text-chevron" />
          {labels.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
