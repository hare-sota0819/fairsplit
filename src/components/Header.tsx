import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { NavIndex } from './nav/NavIndex'
import { HeaderFrame } from './sidebar/ShellFrame'
import { AccountMenu } from './AccountMenu'
import { NavLink } from './NavLoader'

export async function Header() {
  const [session, t, tApp, tLoading] = await Promise.all([
    auth(),
    getTranslations('nav'),
    getTranslations('app'),
    getTranslations('loading'),
  ])
  const wordmark = (
    <NavLink
      href="/"
      caption={tLoading('general')}
      className="text-[13px] leading-[1.6] text-foreground transition-colors duration-fast hover:text-muted-foreground"
    >
      {tApp('name')}
    </NavLink>
  )
  return (
    <HeaderFrame signedIn={Boolean(session?.user)}>
      {/* Sticky (owner, 2026-08-14: the menu scrolled away on long
          screens): pinned to the viewport top, above page content (z-10). The top safe-area inset lives HERE, not
          on <body> — a stuck header sits at viewport y=0, so ITS padding is
          what keeps the notch/status bar off the controls (see layout.tsx's
          body comment). Chrome is typography on the desk (docs/BRAND.md v2
          §2c/§2d): one dark rule below, no fill difference, no shadow. */}
      <header className="sticky top-0 z-20 border-b border-border-strong bg-background">
        <div className="flex items-center justify-between px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
          <div className="flex items-center gap-1">
            {/* The in-place text index (v2 §3) — signed-in only; a stranger
              on the landing/auth screens has nowhere to go yet. The wordmark
              rides inside it so both fade as the links materialise. */}
            {session?.user ? <NavIndex>{wordmark}</NavIndex> : wordmark}
          </div>
          <nav className="flex items-center gap-1 text-sm">
            {session?.user ? (
              /*
               * ONE control, not three. "New group", "Account" and "Sign out"
               * used to sit side by side at equal weight, and none of them told
               * you whose account you were in. Everything that CHANGES the
               * account or the group moved behind the avatar — see
               * AccountMenu; the text index on the left is reading only.
               */
              <AccountMenu
                name={session.user.name?.trim() ?? ''}
                email={session.user.email ?? ''}
                labels={{
                  menu: t('accountMenu'),
                  settings: t('accountSettings'),
                  newGroup: t('newGroup'),
                  manageGroup: t('manageGroup'),
                  invite: t('sidebar.invite'),
                  switchAccount: t('switchAccount'),
                  signOut: t('signOut'),
                }}
              />
            ) : (
              <Link
                href="/signin"
                className="flex h-11 items-center px-2 text-[13px] text-muted-foreground transition-colors duration-fast hover:text-foreground"
              >
                {t('signIn')}
              </Link>
            )}
          </nav>
        </div>
      </header>
    </HeaderFrame>
  )
}
