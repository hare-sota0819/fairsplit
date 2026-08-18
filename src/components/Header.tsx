import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { SidebarToggle } from './sidebar/SidebarToggle'
import { BrandSlot, RailOffset } from './sidebar/ShellFrame'
import { AccountMenu } from './AccountMenu'
import { NavLink } from './NavLoader'
import { Button } from './ui/button'

export async function Header() {
  const [session, t, tApp, tLoading] = await Promise.all([
    auth(),
    getTranslations('nav'),
    getTranslations('app'),
    getTranslations('loading'),
  ])
  return (
    // Sticky (owner, 2026-08-14: the menu scrolled away with long chat
    // transcripts): pinned to the viewport top, above page content and the
    // composer dock (z-10) but under the sidebar drawer/scrim (z-50). The
    // top safe-area inset lives HERE now, not on <body> — a stuck header
    // sits at viewport y=0, so ITS padding is what keeps the notch/status
    // bar off the controls (see layout.tsx's body comment).
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <RailOffset className="flex items-center justify-between px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
        <div className="flex items-center gap-1">
          <SidebarToggle label={t('sidebar.open')} />
          <BrandSlot>
            <NavLink
              href="/"
              caption={tLoading('general')}
              className="rounded-md px-1 font-bold tracking-tight transition-colors hover:text-primary"
            >
              {tApp('name')}
            </NavLink>
          </BrandSlot>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {session?.user ? (
            /*
             * ONE control, not three. "New group", "Account" and "Sign out"
             * used to sit side by side at equal weight, and none of them told
             * you whose account you were in. Everything moved behind the
             * avatar — see AccountMenu.
             */
            <AccountMenu
              name={session.user.name?.trim() ?? ''}
              email={session.user.email ?? ''}
              labels={{
                menu: t('accountMenu'),
                settings: t('accountSettings'),
                newGroup: t('newGroup'),
                switchGroup: t('sidebar.switchGroup'),
                switchAccount: t('switchAccount'),
                signOut: t('signOut'),
              }}
            />
          ) : (
            <Button asChild variant="ghost" size="touch">
              <Link href="/signin">{t('signIn')}</Link>
            </Button>
          )}
        </nav>
      </RailOffset>
    </header>
  )
}
