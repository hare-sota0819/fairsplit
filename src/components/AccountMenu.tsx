'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeftRight, LogOut, Plus, Settings, UserRoundCog } from 'lucide-react'
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
 * The account menu, in the header's top-right corner.
 *
 * It replaces three text links ("New group", "Account", "Sign out") sitting
 * side by side. Three equally-weighted links is what a desktop app does with
 * unlimited width; on a phone header it is a row of competing words and none
 * of them says whose account you are in. One avatar says that, and everything
 * else lives behind it — the convention every account-based product on the
 * web now shares.
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
    switchGroup: string
    switchAccount: string
    signOut: string
  }
}) {
  const router = useRouter()
  const initial = (name || email || '?').slice(0, 1).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={labels.menu}
        data-testid="account-menu"
        className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary outline-none transition-colors hover:brightness-95 focus-visible:ring-3 focus-visible:ring-ring/50"
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

        <DropdownMenuItem
          data-testid="menu-account"
          onSelect={() => router.push('/account')}
        >
          <Settings aria-hidden="true" className="size-4 text-chevron" />
          {labels.settings}
        </DropdownMenuItem>
        {/* Owner (2026-08-16): group switching is a settings-like act, not
            a drawer fixture — it lives here (and in the drawer's own
            account sheet), never as an always-on list. */}
        <DropdownMenuItem
          data-testid="menu-switch-group"
          onSelect={() => router.push('/groups')}
        >
          <ArrowLeftRight aria-hidden="true" className="size-4 text-chevron" />
          {labels.switchGroup}
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid="menu-new-group"
          onSelect={() => router.push('/groups/new')}
        >
          <Plus aria-hidden="true" className="size-4 text-chevron" />
          {labels.newGroup}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

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
